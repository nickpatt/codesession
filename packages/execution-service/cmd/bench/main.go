// Command bench measures time-to-first-output-byte for cold vs warm sandbox
// starts. It prints median/p95 over N iterations for each mode so we can fill
// in the project's warm-vs-cold latency metric with real numbers.
package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/nickpatt/codesession/execution-service/internal/config"
	"github.com/nickpatt/codesession/execution-service/internal/pool"
	"github.com/nickpatt/codesession/execution-service/internal/sandbox"
)

func main() {
	d, err := sandbox.NewDocker()
	if err != nil { panic(err) }
	ctx := context.Background()
	if err := d.Ping(ctx); err != nil { panic(err) }

	cfg := config.Load()
	limits := sandbox.LimitsFromConfig(cfg)
	p := pool.New(d, limits, cfg.PoolSize)
	defer p.Close()
	time.Sleep(3 * time.Second) // let the pool fill

	const N = 15
	code := "print('x')\n"

	measure := func(cold bool) []time.Duration {
		var samples []time.Duration
		for i := 0; i < N; i++ {
			start := time.Now()
			var id string
			if cold {
				id, _ = p.AcquireCold(ctx)
			} else {
				id, _ = p.Acquire(ctx)
			}
			out := make(chan sandbox.OutputChunk, 16)
			first := make(chan time.Duration, 1)
			go func() {
				got := false
				for c := range out {
					if !got { first <- time.Since(start); got = true }
					_ = c
				}
				if !got { first <- time.Since(start) }
			}()
			d.Run(ctx, id, code, 10*time.Second, out)
			close(out)
			samples = append(samples, <-first)
			d.Remove(context.Background(), id)
			time.Sleep(200 * time.Millisecond)
		}
		return samples
	}

	report := func(name string, s []time.Duration) {
		sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
		p50 := s[len(s)/2]
		p95 := s[int(float64(len(s))*0.95)-1]
		fmt.Printf("%s: p50=%s p95=%s min=%s max=%s (n=%d)\n",
			name, p50.Round(time.Millisecond), p95.Round(time.Millisecond),
			s[0].Round(time.Millisecond), s[len(s)-1].Round(time.Millisecond), len(s))
	}

	fmt.Println("measuring cold starts...")
	cold := measure(true)
	fmt.Println("measuring warm starts...")
	warm := measure(false)

	report("COLD", cold)
	report("WARM", warm)
}
