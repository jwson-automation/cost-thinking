// コスト思考 — API + WebSocket server.
// Keeps the whole board state as one JSON document in SQLite and broadcasts
// every mutation to connected clients, so the leader view and member views stay in sync.
package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	_ "modernc.org/sqlite"
)

type Card struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	Checklist  []string `json:"checklist"`
	Materials  string   `json:"materials"`
	Priority   string   `json:"priority"`
	Complexity string   `json:"complexity,omitempty"` // low | mid | high。見積もりの手がかり
	Kind       string   `json:"kind,omitempty"`       // task | meeting | coop | break
	BreakKind  string   `json:"breakKind,omitempty"`  // meal | rest | party
	Checked    []bool   `json:"checked,omitempty"`    // チェックリストの消し込み
	Lang       string   `json:"lang,omitempty"`       // 作った人が見ていた言語。訳がまだかを判断するのに使う
	// 会議・共同業務の予約。この時刻になるとサーバーが勝手に始める。
	StartAt int64 `json:"startAt,omitempty"`
	Started bool  `json:"started,omitempty"` // 予約が発火したか（二度打ち防止）
	SpentMs int64 `json:"spentMs,omitempty"` // 実際に動いていた時間の合計
	// 会議・共同業務は、参加者ひとりずつが自分の手で着手して完了する。
	// カード全体の状態は、この中身から組み立てる。
	Progress map[string]*Progress `json:"progress,omitempty"`

	EstMin       float64    `json:"estMin"`
	Participants []string   `json:"participants"`
	Assignee     string     `json:"assignee"`
	Status       string     `json:"status"`
	Origin       string     `json:"origin"`
	RejectReason string     `json:"rejectReason,omitempty"`
	CreatedAt    int64      `json:"createdAt"`
	StartedAt    int64      `json:"startedAt,omitempty"`
	FinishedAt   int64      `json:"finishedAt,omitempty"`
	History      []Move     `json:"history"`
	Help         *HelpState `json:"help,omitempty"`
	// Assist records who is backing this card up and since when.
	// The owner is Assignee; everyone else in Participants is an assistant.
	Assist map[string]*Assist `json:"assist,omitempty"`
	// メモ。担当も応援も同じ場所に書き、全員が読む。
	Comments  []Comment `json:"comments,omitempty"`
	UpdatedAt int64     `json:"updatedAt,omitempty"`
	// 本文の訳。言語コード（ja/ko/en）がキー。AI が後から埋めるので、無いこともある。
	Tr map[string]Tr `json:"tr,omitempty"`
}

type Comment struct {
	ID   string `json:"id"`
	By   string `json:"by"`
	Text string `json:"text"`
	At   int64  `json:"at"`
	// メモの訳。言語コードがキー。AI が後から埋める。
	Tr map[string]string `json:"tr,omitempty"`
}

// Progress は、共同のカードにおける「その人ぶん」の進み方。
type Progress struct {
	StartedAt  int64 `json:"startedAt,omitempty"`
	FinishedAt int64 `json:"finishedAt,omitempty"`
	SpentMs    int64 `json:"spentMs,omitempty"`
}

type Assist struct {
	JoinedAt int64 `json:"joinedAt"`
	LeftAt   int64 `json:"leftAt,omitempty"`
}

type Move struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
	At   int64  `json:"at"`
}

type HelpState struct {
	By         string   `json:"by"`
	Reason     string   `json:"reason"`
	Minutes    float64  `json:"minutes"`
	At         int64    `json:"at"`
	Helpers    []string `json:"helpers"`
	ResolvedAt int64    `json:"resolvedAt,omitempty"`
}

type Saving struct {
	ID     string `json:"id"`
	CardID string `json:"cardId"`
	Label  string `json:"label"`
	Amount int64  `json:"amount"`
	At     int64  `json:"at"`
	Kind   string `json:"kind"` // saved | missed
}

type FeedItem struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Text     string `json:"text"`
	MemberID string `json:"memberId"`
	CardID   string `json:"cardId"`
	At       int64  `json:"at"`
}

type State struct {
	Cards   []Card     `json:"cards"`
	Savings []Saving   `json:"savings"`
	Feed    []FeedItem `json:"feed"`
	Rev     int64      `json:"rev"`
	// AI の実費。OrcaRouter が返した usage.cost_usd をそのまま積む。
	AISpendUSD float64 `json:"aiSpendUsd"`
	AICalls    int     `json:"aiCalls"`
	// 社員が選んだアバター（memberID -> lion/bear/cat/dog）
	Avatars map[string]string `json:"avatars,omitempty"`
}

type Store struct {
	mu    sync.RWMutex
	state State
	db    *sql.DB
}

func openStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL)`); err != nil {
		return nil, err
	}
	s := &Store{db: db, state: State{Cards: []Card{}, Savings: []Saving{}, Feed: []FeedItem{}}}
	var doc string
	if err := db.QueryRow(`SELECT doc FROM board WHERE id = 1`).Scan(&doc); err == nil {
		_ = json.Unmarshal([]byte(doc), &s.state)
	}
	return s, nil
}

func (s *Store) persist() {
	b, err := json.Marshal(s.state)
	if err != nil {
		log.Println("marshal:", err)
		return
	}
	if _, err := s.db.Exec(`INSERT INTO board (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc`, string(b)); err != nil {
		log.Println("persist:", err)
	}
}

/* ---------- websocket hub ---------- */

type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]bool
}

func (h *Hub) add(c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
}
func (h *Hub) remove(c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	c.Close()
}
func (h *Hub) broadcast(payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		c.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := c.WriteMessage(websocket.TextMessage, b); err != nil {
			delete(h.clients, c)
			c.Close()
		}
	}
}

var (
	store    *Store
	hub      = &Hub{clients: map[*websocket.Conn]bool{}}
	upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
)

/* ---------- helpers ---------- */

func now() int64 { return time.Now().UnixMilli() }

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

// mutate runs fn under the write lock, persists, bumps the revision and
// pushes the new state to every connected client.
func mutate(fn func(st *State)) State {
	store.mu.Lock()
	fn(&store.state)
	store.state.Rev++
	store.persist()
	snapshot := store.state
	store.mu.Unlock()
	hub.broadcast(map[string]any{"type": "state", "state": snapshot})
	return snapshot
}

// withState runs fn under the read lock. 書き換えないこと。
func withState(fn func(st *State)) {
	store.mu.RLock()
	fn(&store.state)
	store.mu.RUnlock()
}

func findCard(st *State, id string) *Card {
	for i := range st.Cards {
		if st.Cards[i].ID == id {
			return &st.Cards[i]
		}
	}
	return nil
}

func pushFeed(st *State, kind, text, memberID, cardID string) {
	item := FeedItem{ID: randID(), Kind: kind, Text: text, MemberID: memberID, CardID: cardID, At: now()}
	st.Feed = append([]FeedItem{item}, st.Feed...)
	if len(st.Feed) > 60 {
		st.Feed = st.Feed[:60]
	}
}

// randID returns a short unique id.
//
// 以前は時刻（UnixNano）から作っていたが、Windows の時計は分解能が粗く、
// 続けて呼ぶと同じ値が返って **カードが同じ id を持つ** ことが実際に起きた。
// 乱数から作る。
func randID() string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 7)
	if _, err := rand.Read(b); err != nil {
		// 乱数が取れないのは異常だが、ここで落とすほどではない
		n := time.Now().UnixNano()
		for i := range b {
			b[i] = byte(n >> (8 * i))
		}
	}
	for i := range b {
		b[i] = letters[int(b[i])%len(letters)]
	}
	return string(b)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
func remove(list []string, v string) []string {
	out := list[:0:0]
	for _, x := range list {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

/* ---------- handlers ---------- */

func handleState(w http.ResponseWriter, r *http.Request) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	writeJSON(w, store.state)
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	hub.add(c)
	store.mu.RLock()
	snapshot := store.state
	store.mu.RUnlock()
	b, _ := json.Marshal(map[string]any{"type": "state", "state": snapshot})
	_ = c.WriteMessage(websocket.TextMessage, b)

	go func() {
		defer hub.remove(c)
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

type cardReq struct {
	Title        string   `json:"title"`
	Summary      string   `json:"summary"`
	Checklist    []string `json:"checklist"`
	Materials    string   `json:"materials"`
	Priority     string   `json:"priority"`
	Complexity   string   `json:"complexity"`
	Kind         string   `json:"kind"`
	BreakKind    string   `json:"breakKind"`
	StartAt      int64    `json:"startAt"`
	Lang         string   `json:"lang"`
	EstMin       float64  `json:"estMin"`
	Participants []string `json:"participants"`
	Origin       string   `json:"origin"`
}

func handleCreateCard(w http.ResponseWriter, r *http.Request) {
	var req cardReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if req.Priority == "" {
		req.Priority = "mid"
	}
	if req.Kind == "" {
		req.Kind = "task"
	}
	card := Card{
		ID: randID(), Title: req.Title, Summary: req.Summary, Checklist: req.Checklist,
		Materials: req.Materials, Priority: req.Priority, Complexity: req.Complexity,
		Kind: req.Kind, BreakKind: req.BreakKind, StartAt: req.StartAt, Lang: req.Lang, EstMin: req.EstMin,
		Participants: req.Participants, Status: "unassigned", Origin: req.Origin,
		CreatedAt: now(), History: []Move{},
	}
	if card.Checklist == nil {
		card.Checklist = []string{}
	}
	if card.Participants == nil {
		card.Participants = []string{}
	}
	st := mutate(func(st *State) {
		st.Cards = append([]Card{card}, st.Cards...)
		pushFeed(st, "create", "カードを登録："+card.Title, "", card.ID)
	})
	if card.Kind != "break" {
		translateCardAsync(card.ID) // 画面は待たせない。訳は届き次第 WebSocket で流れる
	}
	writeJSON(w, st)
}

type moveReq struct {
	CardID string `json:"cardId"`
	To     string `json:"to"`
	From   string `json:"from"`
	Kind   string `json:"kind"` // assign | delegate | escalate | return
	Label  string `json:"label"`
	Text   string `json:"text"`
}

func handleMove(w http.ResponseWriter, r *http.Request) {
	var req moveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		from := req.From
		if from == "" {
			from = c.Assignee
		}
		c.History = append(c.History, Move{From: from, To: req.To, Kind: req.Kind, At: now()})
		c.Assignee = req.To
		if req.Kind == "delegate" || req.Kind == "escalate" {
			c.Participants = remove(c.Participants, from)
			c.Status = "inbox"
		}
		if !contains(c.Participants, req.To) {
			c.Participants = append(c.Participants, req.To)
		}
		if c.Status == "unassigned" {
			c.Status = "inbox"
		}
		pushFeed(st, req.Kind, req.Text, req.To, c.ID)
	})
	writeJSON(w, st)
}

type statusReq struct {
	CardID string `json:"cardId"`
	Status string `json:"status"`
	Reason string `json:"reason"`
	Text   string `json:"text"`
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	var req statusReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		c.Status = req.Status
		switch req.Status {
		case "running":
			// 止まっていたぶんは数えない。再開した今から数え直す。
			if c.StartedAt == 0 {
				c.StartedAt = now()
			}
		case "keep":
			if c.StartedAt > 0 {
				c.SpentMs += now() - c.StartedAt
				c.StartedAt = 0
			}
		case "done":
			if c.StartedAt > 0 {
				c.SpentMs += now() - c.StartedAt
			}
			c.FinishedAt = now()
		case "rejected":
			c.RejectReason = req.Reason
		}
		if req.Text != "" {
			pushFeed(st, req.Status, req.Text, c.Assignee, c.ID)
		}
	})
	writeJSON(w, st)
}

type helpReq struct {
	CardID   string  `json:"cardId"`
	MemberID string  `json:"memberId"`
	Reason   string  `json:"reason"`
	Minutes  float64 `json:"minutes"`
	Text     string  `json:"text"`
}

func handleHelpRequest(w http.ResponseWriter, r *http.Request) {
	var req helpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		m := req.Minutes
		if m == 0 {
			m = 30
		}
		c.Help = &HelpState{By: req.MemberID, Reason: req.Reason, Minutes: m, At: now(), Helpers: []string{}}
		pushFeed(st, "help", req.Text, req.MemberID, c.ID)
	})
	writeJSON(w, st)
}

func handleHelpOffer(w http.ResponseWriter, r *http.Request) {
	var req helpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || c.Help == nil {
			return
		}
		if !contains(c.Help.Helpers, req.MemberID) {
			c.Help.Helpers = append(c.Help.Helpers, req.MemberID)
		}
		if c.Assist == nil {
			c.Assist = map[string]*Assist{}
		}
		if a, ok := c.Assist[req.MemberID]; !ok || a.LeftAt != 0 {
			c.Assist[req.MemberID] = &Assist{JoinedAt: now()}
		}
		if !contains(c.Participants, req.MemberID) {
			c.Participants = append(c.Participants, req.MemberID)
		}
		pushFeed(st, "helped", req.Text, req.MemberID, c.ID)
	})
	writeJSON(w, st)
}

func handleHelpResolve(w http.ResponseWriter, r *http.Request) {
	var req helpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || c.Help == nil {
			return
		}
		c.Help.ResolvedAt = now()
		pushFeed(st, "resolved", req.Text, req.MemberID, c.ID)
	})
	writeJSON(w, st)
}

type joinReq struct {
	CardID   string `json:"cardId"`
	MemberID string `json:"memberId"`
	Text     string `json:"text"`
}

func handleJoin(w http.ResponseWriter, r *http.Request) {
	var req joinReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || c.Assignee == req.MemberID {
			return // 担当者本人は応援に入れない
		}
		if c.Assist == nil {
			c.Assist = map[string]*Assist{}
		}
		if a, ok := c.Assist[req.MemberID]; ok && a.LeftAt == 0 {
			return // すでに応援中
		}
		c.Assist[req.MemberID] = &Assist{JoinedAt: now()}
		if !contains(c.Participants, req.MemberID) {
			c.Participants = append(c.Participants, req.MemberID)
		}
		pushFeed(st, "join", req.Text, req.MemberID, c.ID)
	})
	writeJSON(w, st)
}

// handleLeave ends an assist. The elapsed time stays on the card so the cost
// keeps whatever the assistant already spent.
func handleLeave(w http.ResponseWriter, r *http.Request) {
	var req joinReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || c.Assist == nil {
			return
		}
		a, ok := c.Assist[req.MemberID]
		if !ok || a.LeftAt != 0 {
			return
		}
		a.LeftAt = now()
		c.Participants = remove(c.Participants, req.MemberID)
		pushFeed(st, "leave", req.Text, req.MemberID, c.ID)
	})
	writeJSON(w, st)
}

type savingReq struct {
	CardID string `json:"cardId"`
	Label  string `json:"label"`
	Amount int64  `json:"amount"`
	Kind   string `json:"kind"`
}

func handleSaving(w http.ResponseWriter, r *http.Request) {
	var req savingReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		s := Saving{ID: randID(), CardID: req.CardID, Label: req.Label, Amount: req.Amount, At: now(), Kind: req.Kind}
		st.Savings = append([]Saving{s}, st.Savings...)
	})
	writeJSON(w, st)
}

type commentReq struct {
	CardID   string `json:"cardId"`
	MemberID string `json:"memberId"`
	Text     string `json:"text"`
}

// handleComment appends a memo everyone on the card can read.
func handleComment(w http.ResponseWriter, r *http.Request) {
	var req commentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		http.Error(w, "text is required", 400)
		return
	}
	commentID := randID()
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		c.Comments = append(c.Comments, Comment{ID: commentID, By: req.MemberID, Text: req.Text, At: now()})
	})
	translateCommentAsync(req.CardID, commentID)
	writeJSON(w, st)
}

type updateReq struct {
	CardID     string   `json:"cardId"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	Checklist  []string `json:"checklist"`
	Priority   string   `json:"priority"`
	Complexity string   `json:"complexity"`
	EstMin     float64  `json:"estMin"`
	Status     string   `json:"status"` // 差し戻されたカードを直して戻すときに使う
	Text       string   `json:"text"`
}

// handleUpdateCard edits a card. A rejected card can be fixed and sent back.
func handleUpdateCard(w http.ResponseWriter, r *http.Request) {
	var req updateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		if strings.TrimSpace(req.Title) != "" {
			c.Title = req.Title
		}
		c.Summary = req.Summary
		if req.Checklist != nil {
			c.Checklist = req.Checklist
		}
		if req.Priority != "" {
			c.Priority = req.Priority
		}
		if req.Complexity != "" {
			c.Complexity = req.Complexity
		}
		if req.EstMin > 0 {
			c.EstMin = req.EstMin
		}
		if req.Status != "" {
			c.Status = req.Status
			if req.Status != "rejected" {
				c.RejectReason = "" // 直したので理由は消す
			}
		}
		c.UpdatedAt = now()
		c.Tr = nil // 本文が変わったので古い訳は捨てる
		if req.Text != "" {
			pushFeed(st, "update", req.Text, c.Assignee, c.ID)
		}
	})
	translateCardAsync(req.CardID)
	writeJSON(w, st)
}

type checkReq struct {
	CardID string `json:"cardId"`
	Index  int    `json:"index"`
	Done   bool   `json:"done"`
}

// handleCheck ticks one checklist item off. 誰が押しても同じ結果になる。
func handleCheck(w http.ResponseWriter, r *http.Request) {
	var req checkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || req.Index < 0 || req.Index >= len(c.Checklist) {
			return
		}
		for len(c.Checked) < len(c.Checklist) {
			c.Checked = append(c.Checked, false)
		}
		c.Checked[req.Index] = req.Done
	})
	writeJSON(w, st)
}

type kindReq struct {
	CardID string `json:"cardId"`
	Kind   string `json:"kind"`
	Join   string `json:"join"`  // 参加する人
	Leave  string `json:"leave"` // 参加をやめる人
	Text   string `json:"text"`
}

// handleKind switches a card between a single-owner task and shared work,
// and lets people join or leave it. ドラッグせずに参加できるようにするための入口。
func handleKind(w http.ResponseWriter, r *http.Request) {
	var req kindReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		if req.Kind != "" {
			c.Kind = req.Kind
			if req.Kind == "coop" || req.Kind == "meeting" {
				// 担当ひとりだったカードを共同にするので、担当も参加者に入れる
				if c.Assignee != "" && !contains(c.Participants, c.Assignee) {
					c.Participants = append(c.Participants, c.Assignee)
				}
			}
		}
		if req.Join != "" && !contains(c.Participants, req.Join) {
			c.Participants = append(c.Participants, req.Join)
			if c.Assignee == "" {
				c.Assignee = req.Join
			}
			if c.Status == "unassigned" {
				c.Status = "inbox"
			}
		}
		if req.Leave != "" {
			c.Participants = remove(c.Participants, req.Leave)
			if c.Assignee == req.Leave {
				c.Assignee = ""
				if len(c.Participants) > 0 {
					c.Assignee = c.Participants[0]
				}
			}
		}
		c.UpdatedAt = now()
		if req.Text != "" {
			pushFeed(st, "kind", req.Text, c.Assignee, c.ID)
		}
	})
	writeJSON(w, st)
}

type progressReq struct {
	CardID   string `json:"cardId"`
	MemberID string `json:"memberId"`
	Action   string `json:"action"` // start | keep | done
	Text     string `json:"text"`
}

// handleProgress moves one participant's own state on a shared card.
// 会議は全員の時間を同時に使うが、着手も完了もひとりずつ押す。
func handleProgress(w http.ResponseWriter, r *http.Request) {
	var req progressReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil || req.MemberID == "" {
			return
		}
		if c.Progress == nil {
			c.Progress = map[string]*Progress{}
		}
		p := c.Progress[req.MemberID]
		if p == nil {
			p = &Progress{}
			c.Progress[req.MemberID] = p
		}
		at := now()
		switch req.Action {
		case "start":
			if p.StartedAt == 0 {
				p.StartedAt = at
			}
			p.FinishedAt = 0
		case "keep":
			if p.StartedAt > 0 {
				p.SpentMs += at - p.StartedAt
				p.StartedAt = 0
			}
		case "done":
			if p.StartedAt > 0 {
				p.SpentMs += at - p.StartedAt
				p.StartedAt = 0
			}
			p.FinishedAt = at
		}
		syncSharedCard(c, at)
		if req.Text != "" {
			pushFeed(st, req.Action, req.Text, req.MemberID, c.ID)
		}
	})
	writeJSON(w, st)
}

// syncSharedCard は、参加者ひとりずつの進み方からカード全体の状態を組み立てる。
// 画面もタイムラインも「カードの状態」を見ているので、そこを合わせておく。
func syncSharedCard(c *Card, at int64) {
	if len(c.Participants) == 0 {
		return
	}
	running, done, first, last := 0, 0, int64(0), int64(0)
	var spent int64
	for _, id := range c.Participants {
		p := c.Progress[id]
		if p == nil {
			continue
		}
		if p.StartedAt > 0 {
			running++
			if first == 0 || p.StartedAt < first {
				first = p.StartedAt
			}
		}
		if p.FinishedAt > 0 {
			done++
			if p.FinishedAt > last {
				last = p.FinishedAt
			}
		}
		s := p.SpentMs
		if p.StartedAt > 0 {
			s += at - p.StartedAt
		}
		if s > spent {
			spent = s // 一番長く関わった人の時間を、このカードの実績とする
		}
	}
	c.SpentMs = spent
	switch {
	case done == len(c.Participants):
		c.Status = "done"
		c.FinishedAt = last
		c.StartedAt = 0
	case running > 0:
		c.Status = "running"
		c.StartedAt = first
		c.FinishedAt = 0
	default:
		if c.Status == "running" {
			c.Status = "inbox"
		}
		c.StartedAt = 0
	}
}

type scheduleReq struct {
	CardID  string `json:"cardId"`
	StartAt int64  `json:"startAt"` // 0 なら予約を取り消す
	Text    string `json:"text"`
}

// handleSchedule sets (or clears) when a meeting or shared task should begin.
func handleSchedule(w http.ResponseWriter, r *http.Request) {
	var req scheduleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		c := findCard(st, req.CardID)
		if c == nil {
			return
		}
		c.StartAt = req.StartAt
		c.Started = false // 時刻を変えたら、もう一度発火できるようにする
		c.UpdatedAt = now()
		if req.Text != "" {
			pushFeed(st, "schedule", req.Text, c.Assignee, c.ID)
		}
	})
	// 過去の時刻を入れられたらその場で始める
	runDueCards()
	writeJSON(w, st)
}

type avatarReq struct {
	MemberID string `json:"memberId"`
	Avatar   string `json:"avatar"`
}

// handleAvatar stores which face a member picked, so every screen shows the same one.
func handleAvatar(w http.ResponseWriter, r *http.Request) {
	var req avatarReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		if st.Avatars == nil {
			st.Avatars = map[string]string{}
		}
		st.Avatars[req.MemberID] = req.Avatar
	})
	writeJSON(w, st)
}

func handleSeed(w http.ResponseWriter, r *http.Request) {
	var body State
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	st := mutate(func(st *State) {
		st.Cards = body.Cards
		st.Savings = body.Savings
		st.Feed = body.Feed
	})
	// デモのカードも訳しておく。英語・韓国語で開いても中身が読めるように。
	for _, c := range body.Cards {
		if c.Kind != "break" {
			translateCardAsync(c.ID)
		}
	}
	writeJSON(w, st)
}

func handleReset(w http.ResponseWriter, r *http.Request) {
	st := mutate(func(st *State) {
		st.Cards = []Card{}
		st.Savings = []Saving{}
		st.Feed = []FeedItem{}
		st.AISpendUSD = 0
		st.AICalls = 0
		// アバターの選択は本人の好みなので残す
	})
	writeJSON(w, st)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8096"
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/board.db"
	}
	if err := os.MkdirAll(dirOf(dbPath), 0o755); err != nil {
		log.Fatal(err)
	}

	var err error
	store, err = openStore(dbPath)
	if err != nil {
		log.Fatal(err)
	}

	// 画面は Vercel、API はここ。別オリジンになるので許可を出す。
	allowOrigin := func(o string) bool {
		if o == "" {
			return false
		}
		allowed := os.Getenv("ALLOW_ORIGINS")
		if allowed == "" {
			allowed = "https://cost.blueberry-team.com,http://localhost:3000"
		}
		for _, a := range strings.Split(allowed, ",") {
			a = strings.TrimSpace(a)
			if a == o || (strings.HasSuffix(a, ".vercel.app") && strings.HasSuffix(o, ".vercel.app")) {
				return true
			}
		}
		return strings.HasSuffix(o, ".vercel.app")
	}
	withCORS := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if o := r.Header.Get("Origin"); allowOrigin(o) {
				w.Header().Set("Access-Control-Allow-Origin", o)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/state", handleState)
	mux.HandleFunc("POST /api/cards", handleCreateCard)
	mux.HandleFunc("POST /api/cards/move", handleMove)
	mux.HandleFunc("POST /api/cards/status", handleStatus)
	mux.HandleFunc("POST /api/cards/join", handleJoin)
	mux.HandleFunc("POST /api/cards/leave", handleLeave)
	mux.HandleFunc("POST /api/help/request", handleHelpRequest)
	mux.HandleFunc("POST /api/help/offer", handleHelpOffer)
	mux.HandleFunc("POST /api/help/resolve", handleHelpResolve)
	mux.HandleFunc("POST /api/savings", handleSaving)
	mux.HandleFunc("POST /api/ai/candidates", handleCandidates)
	mux.HandleFunc("POST /api/cards/comment", handleComment)
	mux.HandleFunc("POST /api/cards/update", handleUpdateCard)
	mux.HandleFunc("POST /api/cards/check", handleCheck)
	mux.HandleFunc("POST /api/cards/kind", handleKind)
	mux.HandleFunc("POST /api/cards/schedule", handleSchedule)
	mux.HandleFunc("POST /api/cards/progress", handleProgress)
	mux.HandleFunc("POST /api/avatar", handleAvatar)
	mux.HandleFunc("POST /api/seed", handleSeed)
	mux.HandleFunc("POST /api/reset", handleReset)
	mux.HandleFunc("/ws", handleWS)

	startScheduler() // 予約された会議・共同業務を時刻になったら始める

	// 画面は Vercel。WEB_DIR を置いたときだけ静的配信もする。
	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, map[string]string{"service": "cost-thinking api", "ui": "https://cost-thinking.vercel.app"})
		})
		log.Printf("cost-thinking API listening on :%s (db=%s)", port, dbPath)
		srv := &http.Server{Addr: ":" + port, Handler: withCORS(mux), ReadHeaderTimeout: 10 * time.Second}
		log.Fatal(srv.ListenAndServe())
		return
	}

	files := http.FileServer(http.Dir(webDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// "/" は index.html（はじめる画面）をそのまま返す
		// 画面のコードは毎回取りに来させる。CDN に古い app.js が残ると直らない。
		switch {
		case strings.HasSuffix(r.URL.Path, ".html"),
			strings.HasSuffix(r.URL.Path, ".js"),
			strings.HasSuffix(r.URL.Path, ".css"):
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		default: // ドット絵などは変わらないので普通にキャッシュさせる
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}
		files.ServeHTTP(w, r)
	})

	log.Printf("cost-thinking listening on :%s (db=%s, web=%s)", port, dbPath, webDir)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}
