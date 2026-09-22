// 会議・共同業務を時間で予約し、その時刻になったら参加者の手を止める。
//
// 設計の要点
//   - 予約の発火はサーバーがやる。画面を開いている人がいなくても始まるし、
//     3人ぶんのブラウザが同時に同じ処理をして二重に動くこともない。
//   - 止めたカードは「誰のせいで止まったか」を覚えておき、会議が終わったら戻す。
//     会議のあと、自分が何をしていたか思い出す手間を人にやらせない。
//   - 止まっている間は時間を数えない。会議に出たせいで見積もり超過になり、
//     貯金が消えるのはおかしいため。実績は「動いていた時間の合計」で持つ。
package main

import (
	"log"
	"time"
)

// 予約を見に行く間隔。会議の開始が最大この長さだけ遅れる。
const tickInterval = 15 * time.Second

// spentMs は、そのカードが実際に動いていた時間（ミリ秒）を返す。
// 止まっている間は増えない。
func spentMs(c *Card, at int64) int64 {
	total := c.SpentMs
	if c.StartedAt > 0 && c.FinishedAt == 0 {
		total += at - c.StartedAt
	}
	return total
}

// beginCard は、予約の時刻になったことを知らせる。
// 着手するかどうかは参加者それぞれが決めるので、ここでは時計を動かさない。
func beginCard(st *State, c *Card, at int64) {
	c.Started = true
	if c.Status == "unassigned" || c.Status == "inbox" || c.Status == "keep" {
		c.Status = "inbox"
	}
	pushFeed(st, "start", "予定の時刻になりました：「"+c.Title+"」", c.Assignee, c.ID)
}

// runDueCards starts every scheduled card whose time has come.
func runDueCards() {
	at := now()
	due := false
	withState(func(st *State) {
		for i := range st.Cards {
			if isDue(&st.Cards[i], at) {
				due = true
				return
			}
		}
	})
	if !due {
		return // 読むだけで終わらせる。何もないのに rev を上げて全員に配らない。
	}
	mutate(func(st *State) {
		for i := range st.Cards {
			c := &st.Cards[i]
			if isDue(c, at) {
				beginCard(st, c, at)
			}
		}
	})
}

func isDue(c *Card, at int64) bool {
	if c.Kind != "meeting" && c.Kind != "coop" {
		return false
	}
	return c.StartAt > 0 && c.StartAt <= at && !c.Started &&
		c.Status != "done" && c.Status != "rejected"
}

func startScheduler() {
	go func() {
		for range time.Tick(tickInterval) {
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Println("scheduler:", r)
					}
				}()
				runDueCards()
			}()
		}
	}()
}
