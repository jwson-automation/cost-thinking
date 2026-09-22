// OrcaRouter 連携：カード3案の生成。
//
// 設計の要点
//   - 給与・氏名はモデルに渡さない。渡すのは目標・期待結果・資料と「役職」だけ。
//     金額の計算はクライアント側（役職ごとの時給）で行う。
//   - 難易度の低い定型処理なので安いモデルを既定にし、落ちたら別ベンダーへフォールバックする。
//   - 応答の実費（usage.cost_usd）と実際に答えたモデルをそのまま返し、画面に出す。
//   - 失敗したらルールベースの3案を返す。AI が死んでも画面は止まらない。
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	orcaBase = "https://api.orcarouter.ai/v1"
	// 実測（2026-09-21, 同じプロンプト）で選んだ並び。
	//   google/gemini-2.5-flash … 8.9s / $0.003608 / JSON 3件 ✓  ← 既定
	//   deepseek-v4-flash-free … 10.8s / $0        / JSON 3件 ✓  ← 受け皿
	//
	// 無料モデルを既定にしていたが、混むと 429（free_rate_limited）で断られ、
	// デモの最中にルールベースへ落ちた。1回あたり約 $0.0036（0.5円ほど）なので、
	// 有料を既定にして無料を受け皿に回す。利用者の承諾済み。
	//   openai/gpt-5-nano       … 9.9s / $0.000608 / JSON 崩れ
	//   qwen/qwen3.7-flash      … 60.2s               （遅すぎ）
	//   z-ai/glm-5.3-flash      … 45s 超で打ち切り     （推論型で遅い）
	primaryModel    = "google/gemini-2.5-flash"
	freeModel       = "deepseek/deepseek-v4-flash-free"
	fallbackModelB  = "openai/gpt-5-nano"
	aiRequestBudget = 45 * time.Second
)

type candidateReq struct {
	Goal       string   `json:"goal"`
	Checklist  []string `json:"checklist"`
	Priority   string   `json:"priority"`
	Complexity string   `json:"complexity"` // low | mid | high
	Kind       string   `json:"kind"`       // task | meeting | coop
	Headcount  int      `json:"headcount"`  // 同時に動く人数
	HintMin    int      `json:"hintMin"`    // 画面側の計算式が出した目安（分）
	Materials  string   `json:"materials"`
	Roles      []string `json:"roles"` // 参加予定者の役職だけ（氏名・給与は渡さない）
	Lang       string   `json:"lang"`  // 画面の言語。カードもこの言語で書く。
}

type Candidate struct {
	Kind      string   `json:"kind"`
	Tag       string   `json:"tag"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary"`
	Checklist []string `json:"checklist"`
	EstMin    int      `json:"estMin"`
	Note      string   `json:"note"`
}

type candidateRes struct {
	Candidates []Candidate `json:"candidates"`
	Model      string      `json:"model"`     // 実際に答えたモデル
	Router     string      `json:"router"`    // 使ったルーター
	CostUSD    float64     `json:"costUsd"`   // 実費（OrcaRouter の計算）
	RequestID  string      `json:"requestId"` // 後から照会するための id
	Fallback   bool        `json:"fallback"`  // AI ではなくルールベースで返したか
	Reason     string      `json:"reason"`    // フォールバックした理由
}

const systemPrompt = `あなたは日本企業のチームリーダーを補佐するアシスタントです。
与えられた業務の目標から、作業カードの案を3つ作ります。

必ず次の3種類を1つずつ作ってください。
1. kind="as-is"      入力された目標と期待結果をそのまま構造化したもの。工程を足さない。
2. kind="predicted"  目標から逆算し、抜けがちな準備・確認・共有の工程を足したもの。
3. kind="standard"   同種の業務の標準的な進め方に当てはめたもの。個別事情は反映しない。

estMin は所要時間の見積もり（分）です。15分単位の整数にしてください。
complexity は入力者が申告した難しさ（low/mid/high）です。high なら調査・確認の工程を厚くし、
low なら手順を最小限にしてください。見積もり時間もそれに合わせます。

baseline_minutes は画面側の計算式が出した目安です。
  下ごしらえ30分 ＋ 期待結果1件につき20分 ＋ 目標20字につき15分 × 複雑度（low 0.7 / mid 1.0 / high 1.6）
predicted はこの目安の前後、as-is はやや短め、standard は目安どおりを基準にし、
大きく離れる場合だけ note にその理由を書いてください。

card_kind が meeting のときは headcount 人が同時に拘束されます。
人数が増えるほど短く終わらせる工夫（事前資料・決める議題を絞る）を checklist に入れてください。
as-is < predicted となるようにし、standard は一般的な所要時間にしてください。
checklist は1項目20文字程度の短い日本語、3〜6項目。
note はその案を選ぶとどうなるかを1文で。
金額や給与には触れないでください。出力は JSON のみ。`

func aiKey() string { return strings.TrimSpace(os.Getenv("ORCAROUTER_API_KEY")) }

// callOrcaRouter asks for the three candidates and reports what it cost.
//
// 無料モデルは混んでいると 429（free_rate_limited）で断られる。models の並びは
// 「モデルが答えられなかったとき」の受け皿で、入口で断られるとそこまで届かない。
// そのときは有料モデルだけの並びでもう一度だけ叩く。デモの最中に
// ルールベースへ落ちるより、数円払うほうがいい。
func callOrcaRouter(req candidateReq) (*candidateRes, error) {
	out, err := callOrcaRouterWith(req, []string{primaryModel, freeModel, fallbackModelB})
	if err != nil && isBusy(err) {
		log.Printf("ai: retrying without the free model")
		return callOrcaRouterWith(req, []string{primaryModel, fallbackModelB})
	}
	return out, err
}

// isBusy は「モデルではなく入口で断られた」かどうか。
func isBusy(err error) bool {
	if err == nil {
		return false
	}
	m := err.Error()
	return strings.Contains(m, "orcarouter 429") || strings.Contains(m, "free_rate_limited") ||
		strings.Contains(m, "orcarouter 5")
}

func callOrcaRouterWith(req candidateReq, models []string) (*candidateRes, error) {
	key := aiKey()
	if key == "" {
		return nil, errors.New("ORCAROUTER_API_KEY is not set")
	}

	user := map[string]any{
		"goal":             req.Goal,
		"expected_results": req.Checklist,
		"priority":         req.Priority,
		"complexity":       req.Complexity,
		"card_kind":        req.Kind,
		"headcount":        req.Headcount,
		"baseline_minutes": req.HintMin,
		"materials":        req.Materials,
		"member_roles":     req.Roles, // 役職のみ
	}
	userJSON, _ := json.Marshal(user)

	sys := systemPrompt
	if req.Lang == "ko" {
		sys += "\n\n出力する title・summary・checklist・note は、すべて韓国語で書いてください。"
	}

	body := map[string]any{
		"model": models[0],
		"messages": []map[string]string{
			{"role": "system", "content": sys},
			{"role": "user", "content": string(userJSON) + "\n\n" +
				`{"candidates":[{"kind":"as-is","tag":"① 入力そのまま","title":"","summary":"","checklist":[],"estMin":0,"note":""}]} の形で3件返してください。`},
		},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      2000,
		"temperature":     0.4,
		// 1本目が落ちたら別ベンダーへ。サービスを止めないための受け皿。
		"models": models,
	}
	buf, _ := json.Marshal(body)

	httpReq, err := http.NewRequest("POST", orcaBase+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+key)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-OrcaRouter-Include-Cost", "true") // 実費を応答に含めてもらう

	client := &http.Client{Timeout: aiRequestBudget}
	res, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orcarouter %d: %s", res.StatusCode, trim(string(raw), 200))
	}

	var parsed struct {
		Model   string `json:"model"`
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

	cands, err := parseCandidates(strings.TrimSpace(content))
	if err != nil {
		return nil, err
	}
	if len(cands) < 3 {
		return nil, fmt.Errorf("expected 3 candidates, got %d", len(cands))
	}

	resolved := res.Header.Get("X-Orca-Resolved-Model")
	if resolved == "" {
		resolved = parsed.Model
	}
	return &candidateRes{
		Candidates: normalize(cands[:3]),
		Model:      resolved,
		Router:     res.Header.Get("X-Orca-Router"),
		CostUSD:    parsed.Usage.CostUSD,
		RequestID:  res.Header.Get("X-Orca-Request-Id"),
	}, nil
}

// parseCandidates は {"candidates":[…]} でも […] でも受け取る。
// モデルによってどちらで返すかが違い、片方しか読めないと「AIが壊れた」ことになる。
func parseCandidates(content string) ([]Candidate, error) {
	var wrapped struct {
		Candidates []Candidate `json:"candidates"`
	}
	if err := json.Unmarshal([]byte(content), &wrapped); err == nil && len(wrapped.Candidates) > 0 {
		return wrapped.Candidates, nil
	}
	var bare []Candidate
	if err := json.Unmarshal([]byte(content), &bare); err == nil && len(bare) > 0 {
		return bare, nil
	}
	return nil, fmt.Errorf("model returned unexpected JSON: %s", trim(content, 120))
}

// normalize keeps the model's output inside the shape the UI expects.
func normalize(cs []Candidate) []Candidate {
	tags := map[string]string{
		"as-is":     "① 入力そのまま",
		"predicted": "② 詳細を予測して追加",
		"standard":  "③ 一般業務ベース",
	}
	for i := range cs {
		if t, ok := tags[cs[i].Kind]; ok {
			cs[i].Tag = t
		} else if cs[i].Tag == "" {
			cs[i].Tag = fmt.Sprintf("案 %d", i+1)
		}
		if cs[i].EstMin <= 0 {
			cs[i].EstMin = 60
		}
		if cs[i].EstMin%15 != 0 {
			cs[i].EstMin = ((cs[i].EstMin + 7) / 15) * 15
		}
		if cs[i].EstMin > 480 {
			cs[i].EstMin = 480 // 1日ぶんを超える見積もりは出さない
		}
	}
	return cs
}

// ruleBased is the safety net: the same three shapes, without any model call.
func ruleBased(req candidateReq) []Candidate {
	base := 30 + len(req.Checklist)*30 + len([]rune(req.Goal))/6*15
	switch req.Complexity { // 申告された難しさを見積もりに反映する
	case "high":
		base = base * 3 / 2
	case "low":
		base = base * 2 / 3
	}
	round := func(n int) int {
		if n < 15 {
			n = 15
		}
		return ((n + 7) / 15) * 15
	}
	extra := append(append([]string{}, req.Checklist...),
		"着手前に前提と完了条件を確定する",
		"影響範囲を洗い出す",
		"完了後にレビュー依頼と共有まで行う")
	return []Candidate{
		{Kind: "as-is", Tag: "① 入力そのまま", Title: req.Goal,
			Summary: "入力された目標・期待結果をそのまま構造化しました。", Checklist: req.Checklist,
			EstMin: round(base), Note: "解釈を変えていないので認識ズレは起きにくいです。"},
		{Kind: "predicted", Tag: "② 詳細を予測して追加", Title: req.Goal + "（事前準備込み）",
			Summary: "抜けがちな準備・確認・共有の工程を足しました。", Checklist: extra,
			EstMin: round(base * 8 / 5), Note: "工数は増えますが手戻りを減らせます。"},
		{Kind: "standard", Tag: "③ 一般業務ベース", Title: req.Goal + "（標準テンプレ）",
			Summary: "標準的な進め方に当てはめた版です。", Checklist: []string{"要件の確認と見積もり", "実作業", "セルフチェック", "レビュー依頼"},
			EstMin: round(base * 3 / 4), Note: "最短ですが個別の条件は落ちています。"},
	}
}

func handleCandidates(w http.ResponseWriter, r *http.Request) {
	var req candidateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if strings.TrimSpace(req.Goal) == "" {
		http.Error(w, "goal is required", 400)
		return
	}

	out, err := callOrcaRouter(req)
	if err != nil {
		log.Printf("ai fallback: %v", err)
		writeJSON(w, candidateRes{
			Candidates: ruleBased(req),
			Model:      "(ローカル)",
			Fallback:   true,
			Reason:     trim(err.Error(), 140),
		})
		return
	}

	// 使ったぶんを積み上げて、画面に「本日のAI原価」として出せるようにする
	mutate(func(st *State) { st.AISpendUSD += out.CostUSD; st.AICalls++ })
	writeJSON(w, out)
}

func trim(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
