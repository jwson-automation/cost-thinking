// 人が書いた文字（カードの中身・メモ）を日本語・韓国語・英語に訳す。
//
// 設計の要点
//   - 画面を待たせない。登録はすぐ返し、翻訳は goroutine で後から足す。
//     終わったら mutate → rev が上がり、WebSocket で全員の画面に届く。
//   - 元の言語はそのまま残す。訳が来るまでは元の文が出るだけで、画面は壊れない。
//   - 失敗しても再試行しない。翻訳はあれば嬉しいものであって、業務の本体ではない。
//   - 翻訳は無料モデルを既定にする。落ちたら有料の受け皿へ回す。
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// 画面が選べる言語。翻訳もこの3つぶんを作る。
var langs = []string{"ja", "ko", "en"}

const translateBudget = 40 * time.Second

// Tr はカード1枚ぶんの訳。言語コードをキーに Card.Tr へ入る。
type Tr struct {
	Title     string   `json:"title,omitempty"`
	Summary   string   `json:"summary,omitempty"`
	Checklist []string `json:"checklist,omitempty"`
}

const translateSystem = `You translate short workplace text for a task board.
Return JSON only. Keep the meaning, the tone and the length close to the source.
Do not add explanations, notes or quotation marks that are not in the source.
Keep product names, URLs and numbers as they are.
Japanese must be polite (です・ます). Korean must be polite (해요체). English must be plain and natural.`

// callTranslate asks the model for one object per language.
// shape は返してほしい JSON の見本。呼ぶ側が形を決める。
func callTranslate(payload any, shape string) (map[string]json.RawMessage, error) {
	out, err := callTranslateWith(payload, shape, []string{primaryModel, freeModel, fallbackModelB})
	if err != nil && isBusy(err) {
		return callTranslateWith(payload, shape, []string{primaryModel, fallbackModelB})
	}
	return out, err
}

func callTranslateWith(payload any, shape string, models []string) (map[string]json.RawMessage, error) {
	key := aiKey()
	if key == "" {
		return nil, errors.New("ORCAROUTER_API_KEY is not set")
	}
	src, _ := json.Marshal(payload)

	body := map[string]any{
		"model": models[0],
		"messages": []map[string]string{
			{"role": "system", "content": translateSystem},
			{"role": "user", "content": string(src) + "\n\n" +
				"Translate into Japanese (ja), Korean (ko) and English (en). Answer exactly in this shape:\n" + shape},
		},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      1400,
		"temperature":     0.2,
		"models":          models,
	}
	buf, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", orcaBase+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-OrcaRouter-Include-Cost", "true")

	res, err := (&http.Client{Timeout: translateBudget}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orcarouter %d: %s", res.StatusCode, trim(string(raw), 200))
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			CostUSD float64 `json:"cost_usd"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, errors.New("empty response")
	}

	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var out map[string]json.RawMessage
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &out); err != nil {
		return nil, fmt.Errorf("model returned non-JSON: %w", err)
	}
	if parsed.Usage.CostUSD > 0 {
		mutate(func(st *State) { st.AISpendUSD += parsed.Usage.CostUSD; st.AICalls++ })
	}
	return out, nil
}

// translateCardAsync fills Card.Tr in the background.
func translateCardAsync(cardID string) {
	go func() {
		var title, summary string
		var checklist []string
		withState(func(st *State) {
			if c := findCard(st, cardID); c != nil {
				title, summary, checklist = c.Title, c.Summary, append([]string{}, c.Checklist...)
			}
		})
		if strings.TrimSpace(title) == "" {
			return
		}
		out, err := callTranslate(
			map[string]any{"title": title, "summary": summary, "checklist": checklist},
			`{"ja":{"title":"","summary":"","checklist":[]},"ko":{"title":"","summary":"","checklist":[]},"en":{"title":"","summary":"","checklist":[]}}`,
		)
		if err != nil {
			log.Printf("translate card %s: %v", cardID, err)
			return
		}
		trs := map[string]Tr{}
		for _, l := range langs {
			raw, ok := out[l]
			if !ok {
				continue
			}
			var tr Tr
			if json.Unmarshal(raw, &tr) != nil || strings.TrimSpace(tr.Title) == "" {
				continue
			}
			trs[l] = tr
		}
		if len(trs) == 0 {
			return
		}
		mutate(func(st *State) {
			c := findCard(st, cardID)
			if c == nil {
				return
			}
			// 直近の本文と食い違っていたら捨てる（訳している間に編集されたとき）
			if c.Title != title {
				return
			}
			c.Tr = trs
		})
	}()
}

// translateCommentAsync fills one memo's Tr in the background.
func translateCommentAsync(cardID, commentID string) {
	go func() {
		var text string
		withState(func(st *State) {
			if c := findCard(st, cardID); c != nil {
				for _, m := range c.Comments {
					if m.ID == commentID {
						text = m.Text
					}
				}
			}
		})
		if strings.TrimSpace(text) == "" {
			return
		}
		out, err := callTranslate(
			map[string]any{"text": text},
			`{"ja":{"text":""},"ko":{"text":""},"en":{"text":""}}`,
		)
		if err != nil {
			log.Printf("translate memo %s: %v", commentID, err)
			return
		}
		trs := map[string]string{}
		for _, l := range langs {
			raw, ok := out[l]
			if !ok {
				continue
			}
			var v struct {
				Text string `json:"text"`
			}
			if json.Unmarshal(raw, &v) != nil || strings.TrimSpace(v.Text) == "" {
				continue
			}
			trs[l] = v.Text
		}
		if len(trs) == 0 {
			return
		}
		mutate(func(st *State) {
			c := findCard(st, cardID)
			if c == nil {
				return
			}
			for i := range c.Comments {
				if c.Comments[i].ID == commentID {
					c.Comments[i].Tr = trs
				}
			}
		})
	}()
}
