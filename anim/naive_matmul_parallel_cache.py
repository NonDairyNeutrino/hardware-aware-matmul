from manim import *
import numpy as np

N = 3  # matrix size AND number of threads (one column of C per thread)
L = 3  # cache-line size in elements (illustrative; a real 64 B line = 8 doubles)
A_VALS = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
B_VALS = [[9, 8, 7], [6, 5, 4], [3, 2, 1]]
C_VALS = (np.array(A_VALS) @ np.array(B_VALS)).tolist()

T_COLORS = [RED_C, YELLOW, BLUE_C]  # thread 1, 2, 3
SHARED = GREEN                      # data read by every thread


def addr(r, c):
    """Column-major (Julia / Fortran) address of element (r, c)."""
    return c * N + r


class ParallelCacheOptimalMatMul(Scene):
    def construct(self):
        # ---------- Title ----------
        title = Text("Parallel + Cache-Optimal Matrix Multiplication", font_size=32)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))

        # ---------- Matrices:  A x B = C ----------
        mat_kw = dict(h_buff=1.0, v_buff=0.8)
        A = Matrix(A_VALS, **mat_kw)
        B = Matrix(B_VALS, **mat_kw)
        C = Matrix([[0] * N for _ in range(N)], **mat_kw)

        row = VGroup(A, MathTex(r"\times"), B, MathTex("="), C).arrange(RIGHT, buff=0.3)
        row.scale(0.5).move_to(LEFT * 3.3 + UP * 1.9)
        labels = VGroup(
            MathTex("A").next_to(A, UP, buff=0.15),
            MathTex("B").next_to(B, UP, buff=0.15),
            MathTex("C").next_to(C, UP, buff=0.15),
        )
        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        B_cols, C_cols = B.get_columns(), C.get_columns()
        self.play(FadeIn(row), FadeIn(labels))

        # ---------- Memory strips (column-major) with cache-line boxes ----------
        cells, txts, rects = {}, {}, {}

        def make_strip(name, mat, y):
            vals = [mat[r][c] for c in range(N) for r in range(N)]  # column-major
            cs = [Square(side_length=0.5, stroke_width=1.5, color=GREY_C) for _ in range(N * N)]
            groups = VGroup(
                *[VGroup(*cs[g * L:(g + 1) * L]).arrange(RIGHT, buff=0) for g in range(N * N // L)]
            )
            groups.arrange(RIGHT, buff=0.18).move_to(LEFT * 3.0 + UP * y)
            ts = [MathTex(str(v), font_size=22).move_to(c) for v, c in zip(vals, cs)]
            rs = [SurroundingRectangle(g, buff=0.03, color=GREY_A, stroke_width=3) for g in groups]
            lab = Text(name, font_size=22).next_to(groups, LEFT, buff=0.3)
            cells[name], txts[name], rects[name] = cs, ts, rs
            return VGroup(groups, *ts, *rs, lab)

        strips = VGroup(
            make_strip("A", A_VALS, 0.2),
            make_strip("B", B_VALS, -0.5),
            make_strip("C", [[0] * N for _ in range(N)], -1.2),
        )
        caption = Text(
            "memory, column-major  |  one cache line = 3 elements",
            font_size=18, color=GREY_B,
        ).move_to(LEFT * 3.2 + UP * 0.78)
        # ---------- Narration (bottom-left, one short caption at a time) ----------
        narr = [None]

        def say(msg):
            """Return the animation that swaps the narration caption to `msg`."""
            new = Text(msg, font_size=20, line_spacing=0.9, color=GREY_A)
            if new.width > 6.2:
                new.scale(6.2 / new.width)
            new.move_to(LEFT * 3.2 + DOWN * 2.8)
            old, narr[0] = narr[0], new
            return FadeIn(new) if old is None else FadeTransform(old, new)

        def pause(k, long=1.8, short=0.4):
            """Give the viewer time to read: long on the first k pass, brief afterwards."""
            self.wait(long if k == 0 else short)

        self.play(
            FadeIn(strips), FadeIn(caption),
            say("Arrays live in memory column-major, so a column is\n"
                "contiguous. The CPU fetches memory a cache line at a time."),
        )
        self.wait(2.5)

        # ---------- Pseudocode (j-k-i order, column-major friendly) ----------
        spec = [
            (0, "parallel for j in 1..n:  # thread j"),
            (1, "for k in 1..n:"),
            (2, "b = B[k,j]  # hoisted"),
            (2, "for i in 1..n:  # unit stride"),
            (3, "C[i,j] += A[i,k] * b"),
        ]
        lines = VGroup(*[Text(t, font="Monospace", font_size=18) for _, t in spec])
        lines.arrange(DOWN, aligned_edge=LEFT, buff=0.15)
        for (lvl, _), ln in zip(spec, lines):
            ln.shift(RIGHT * 0.35 * lvl)
        lines.to_edge(RIGHT, buff=0.3).shift(UP * 1.6)
        self.play(FadeIn(lines))

        def box_for(idx):
            return SurroundingRectangle(lines[idx], color=WHITE, buff=0.06)

        hl = box_for(0)

        def goto(idx):
            return Transform(hl, box_for(idx))

        # ---------- Per-thread private caches (simple model) ----------
        caches = [set() for _ in range(N)]
        hits, miss, bval = [0] * N, [0] * N, ["-"] * N

        def touch(t, name, idx):
            """Load element idx of matrix `name` on thread t. Returns the line key on a miss."""
            key = (name, idx // L)
            if key in caches[t]:
                hits[t] += 1
                return None
            caches[t].add(key)
            miss[t] += 1
            return key

        def make_stat(t):
            return Text(
                f"T{t + 1}  b={bval[t]}  hit {hits[t]:2d}  miss {miss[t]}",
                font="Monospace", font_size=20, color=T_COLORS[t],
            ).move_to(RIGHT * 2.0 + UP * (-0.2 - 0.5 * t), aligned_edge=LEFT)

        stats = [make_stat(t) for t in range(N)]
        legend = Text("green = A[i,k], read by every thread", font_size=16, color=SHARED)
        legend.move_to(RIGHT * 2.0 + DOWN * 1.65, aligned_edge=LEFT)

        def stat_anims():
            return [Transform(stats[t], make_stat(t)) for t in range(N)]

        def flashes(missed):
            out = []
            for (name, ln), ts in missed.items():
                col = T_COLORS[ts[0]] if len(ts) == 1 else WHITE
                out.append(Indicate(rects[name][ln], color=col, scale_factor=1.12))
            return out

        # ---------- Spawn threads: thread t owns column t of C (and reads column t of B) ----------
        self.play(Create(hl), goto(0))
        own = []
        for t in range(N):
            own.append(SurroundingRectangle(B_cols[t], color=T_COLORS[t], buff=0.1))
            own.append(SurroundingRectangle(C_cols[t], color=T_COLORS[t], buff=0.1))
        self.play(
            *[Create(o) for o in own],
            *[rects["B"][t].animate.set_stroke(T_COLORS[t]) for t in range(N)],
            *[rects["C"][t].animate.set_stroke(T_COLORS[t]) for t in range(N)],
            *[FadeIn(s) for s in stats],
            FadeIn(legend),
            say("One thread per column j: it writes only column j of C\n"
                "and reads column j of B. Each thread has its own cache."),
        )
        self.wait(3)

        # ---------- Main loops ----------
        Cacc = [[0] * N for _ in range(N)]

        for k in range(N):
            rt = 0.9 if k == 0 else 0.3

            # for k ...
            self.play(
                goto(1),
                say(f"k = {k + 1}: use column {k + 1} of A and row {k + 1} of B."),
                run_time=rt * 0.5,
            )
            pause(k, 1.5, 0.3)

            # b = B[k,j]   (each thread loads its own element; column j of B is contiguous)
            anims, missed = [], {}
            for t in range(N):
                idx = addr(k, t)
                key = touch(t, "B", idx)
                bval[t] = B_VALS[k][t]
                if key:
                    missed.setdefault(key, []).append(t)
                anims += [
                    B_ent[k * N + t].animate.set_color(T_COLORS[t]),
                    cells["B"][idx].animate.set_fill(T_COLORS[t], opacity=0.6),
                ]
            if k == 0:
                msg_b = ("Each thread loads its own b = B[k,j] once and keeps\n"
                         "it in a register. First touch of B's line: a miss.")
            else:
                msg_b = "b = B[k,j]: same cache line as before, so a hit."
            self.play(goto(2), *anims, *flashes(missed), *stat_anims(), say(msg_b), run_time=rt)
            pause(k, 2.5, 0.5)

            # for i ...  (unit stride through column k of A and column j of C)
            self.play(
                goto(3),
                say("Inner loop walks down column k of A and column j of C:\n"
                    "consecutive addresses (unit stride)."),
                run_time=rt * 0.5,
            )
            pause(k, 2.2, 0.3)

            for i in range(N):
                rt_i = 0.8 if (k == 0 and i == 0) else 0.3
                a_idx = addr(i, k)
                anims, missed = [
                    A_ent[i * N + k].animate.set_color(SHARED),
                    cells["A"][a_idx].animate.set_fill(SHARED, opacity=0.6),
                ], {}
                for t in range(N):
                    c_idx = addr(i, t)
                    for name, idx in (("A", a_idx), ("C", c_idx)):
                        key = touch(t, name, idx)
                        if key:
                            missed.setdefault(key, []).append(t)
                    anims += [
                        C_ent[i * N + t].animate.set_color(T_COLORS[t]),
                        cells["C"][c_idx].animate.set_fill(T_COLORS[t], opacity=0.6),
                    ]
                narration = []
                if i == 0:
                    if k == 0:
                        narration = [say("First elements of A[:,k] and C[:,j] are not\n"
                                         "cached yet: misses (flashing lines).")]
                    else:
                        narration = [say("A's next column is a new line: one miss.\n"
                                         "C[:,j] is already cached: hit.")]
                elif i == 1 and k == 0:
                    narration = [say("The rest of the column is on the line we just\n"
                                     "fetched, so every further access is a hit.")]
                self.play(goto(4), *anims, *flashes(missed), *stat_anims(), *narration, run_time=rt_i)
                if narration:
                    pause(k, 2.2, 0.8)

                # C[i,j] += A[i,k] * b
                tf = []
                for t in range(N):
                    Cacc[i][t] += A_VALS[i][k] * B_VALS[k][t]
                    v = Cacc[i][t]
                    new_m = (
                        MathTex(str(v)).match_height(A_ent[0])
                        .move_to(C_ent[i * N + t]).set_color(T_COLORS[t])
                    )
                    new_s = MathTex(str(v), font_size=22).move_to(cells["C"][addr(i, t)])
                    tf += [
                        Transform(C_ent[i * N + t], new_m),
                        Transform(txts["C"][addr(i, t)], new_s),
                    ]
                self.play(*tf, run_time=rt_i * 0.7)

                # clear A / C highlights
                reset = [
                    A_ent[i * N + k].animate.set_color(WHITE),
                    cells["A"][a_idx].animate.set_fill(opacity=0),
                ]
                for t in range(N):
                    reset += [
                        C_ent[i * N + t].animate.set_color(WHITE),
                        cells["C"][addr(i, t)].animate.set_fill(opacity=0),
                    ]
                self.play(*reset, run_time=rt_i * 0.4)

            # done with this k: release the hoisted B[k,j] values
            reset = []
            for t in range(N):
                reset += [
                    B_ent[k * N + t].animate.set_color(WHITE),
                    cells["B"][addr(k, t)].animate.set_fill(opacity=0),
                ]
            self.play(*reset, run_time=rt * 0.4)

        # ---------- Wrap-up ----------
        loads = hits[0] + miss[0]
        self.play(
            FadeOut(hl), FadeOut(legend),
            say("Done: every cache line was fetched once per thread and\n"
                "fully used, and no two threads write the same line."),
        )
        summary = VGroup(
            Text(f"per thread: {loads} loads, {miss[0]} misses", font_size=17, color=WHITE),
            Text("A[:,k], C[:,j]: unit stride", font_size=17, color=GREY_B),
            Text("B[k,j]: hoisted out of i-loop", font_size=17, color=GREY_B),
            Text("each thread owns a column of C,", font_size=17, color=GREY_B),
            Text("so no false sharing", font_size=17, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        summary.move_to(RIGHT * 2.0 + DOWN * 2.45, aligned_edge=LEFT)
        self.play(Write(summary))
        self.wait(2)
