from manim import *
import numpy as np

N = 3  # matrix size AND number of threads (one row of C per thread)
A_VALS = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
B_VALS = [[9, 8, 7], [6, 5, 4], [3, 2, 1]]
C_VALS = (np.array(A_VALS) @ np.array(B_VALS)).tolist()

T_COLORS = [RED_C, YELLOW, BLUE_C]  # thread 1, 2, 3


class ParallelNaiveMatMul(Scene):
    def construct(self):
        # ---------- Title ----------
        title = Text("Parallel Matrix Multiplication (3 threads)", font_size=34)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))

        # ---------- Matrices:  A x B = C ----------
        mat_kw = dict(h_buff=1.0, v_buff=0.8)
        A = Matrix(A_VALS, **mat_kw)
        B = Matrix(B_VALS, **mat_kw)
        C = Matrix([["?"] * N for _ in range(N)], **mat_kw)
        C_target = Matrix(C_VALS, **mat_kw)  # never shown; number templates

        row = VGroup(A, MathTex(r"\times"), B, MathTex("="), C).arrange(RIGHT, buff=0.3)
        row.scale(0.6).move_to(UP * 1.2 + RIGHT * 0.3)
        C_target.scale(0.6).move_to(C)

        labels = VGroup(
            MathTex("A").next_to(A, UP, buff=0.2),
            MathTex("B").next_to(B, UP, buff=0.2),
            MathTex("C").next_to(C, UP, buff=0.2),
        )
        self.play(FadeIn(row), FadeIn(labels))

        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        A_rows, B_cols = A.get_rows(), B.get_columns()

        # ---------- Pseudocode ----------
        spec = [
            (0, "parallel for i in 1..n:  # thread i"),
            (1, "for j in 1..n:"),
            (2, "s = 0"),
            (2, "for k in 1..n:"),
            (3, "s += A[i,k] * B[k,j]"),
            (2, "C[i,j] = s"),
        ]
        lines = VGroup(*[Text(t, font="Monospace", font_size=20) for _, t in spec])
        lines.arrange(DOWN, aligned_edge=LEFT, buff=0.15)
        for (lvl, _), ln in zip(spec, lines):
            ln.shift(RIGHT * 0.35 * lvl)
        lines.to_corner(DL, buff=0.5)
        self.play(FadeIn(lines))

        def box_for(idx):
            return SurroundingRectangle(lines[idx], color=WHITE, buff=0.06)

        hl = box_for(0)

        def goto(idx):
            return Transform(hl, box_for(idx))

        # ---------- Step counter ----------
        def make_step(n):
            return MathTex(rf"\text{{parallel steps: }} {n}", font_size=30).to_corner(
                UR, buff=0.4
            ).shift(DOWN * 0.8)

        step_count = 0
        step_tex = make_step(0)
        self.play(FadeIn(step_tex))

        # ---------- Spawn threads: thread t owns row t of A / row t of C ----------
        tags, row_boxes = VGroup(), []
        a_left = A.get_left()[0] - 0.45
        for t in range(N):
            tag = Text(f"T{t + 1}", font_size=22, color=T_COLORS[t], weight=BOLD)
            tag.move_to([a_left, A_rows[t].get_center()[1], 0])
            tags.add(tag)
            row_boxes.append(SurroundingRectangle(A_rows[t], color=T_COLORS[t], buff=0.1))

        self.play(Create(hl), goto(0))
        self.play(
            *[FadeIn(tg, scale=1.5) for tg in tags],
            *[Create(rb) for rb in row_boxes],
        )

        # ---------- Per-thread running-sum readouts ----------
        def make_sum(t, s):
            return MathTex(
                rf"T_{t + 1}:\;\, {s}", font_size=32, color=T_COLORS[t]
            ).move_to(RIGHT * 0.2 + DOWN * (1.9 + 0.65 * t), aligned_edge=LEFT)

        sums = [make_sum(t, "s=0") for t in range(N)]

        # ---------- Parallel loop ----------
        # Thread t starts its j-loop at column t (mod n), so at any moment the
        # three threads read three *different* columns of B (no contention).
        for j in range(N):
            fast = j > 0
            rt = 0.3 if fast else 1.0
            cols = [(j + t) % N for t in range(N)]

            col_boxes = [
                SurroundingRectangle(B_cols[cols[t]], color=T_COLORS[t], buff=0.1)
                for t in range(N)
            ]
            c_boxes = [
                SurroundingRectangle(C_ent[t * N + cols[t]], color=T_COLORS[t], buff=0.1)
                for t in range(N)
            ]
            self.play(
                goto(1),
                *[Create(b) for b in col_boxes],
                *[Create(b) for b in c_boxes],
                run_time=rt,
            )

            # s = 0  (every thread has its own private s)
            if j == 0:
                self.play(goto(2), *[FadeIn(s) for s in sums], run_time=rt)
            else:
                self.play(
                    goto(2),
                    *[Transform(sums[t], make_sum(t, "s=0")) for t in range(N)],
                    run_time=rt,
                )

            # inner k loop: all 3 threads advance in lockstep
            terms = [[] for _ in range(N)]
            for k in range(N):
                self.play(goto(3), run_time=rt * 0.5)
                anims, used = [], []
                for t in range(N):
                    a = A_ent[t * N + k]
                    b = B_ent[k * N + cols[t]]
                    used += [a, b]
                    terms[t].append(f"{A_VALS[t][k]}\\cdot{B_VALS[k][cols[t]]}")
                    anims += [
                        a.animate.set_color(T_COLORS[t]).scale(1.25),
                        b.animate.set_color(T_COLORS[t]).scale(1.25),
                        Transform(sums[t], make_sum(t, "s=" + "+".join(terms[t]))),
                    ]
                self.play(goto(4), *anims, run_time=rt)

                step_count += 1
                self.play(
                    *[e.animate.set_color(WHITE).scale(1 / 1.25) for e in used],
                    Transform(step_tex, make_step(step_count)),
                    run_time=rt * 0.4,
                )

            # C[i,j] = s  (each thread writes a distinct cell: no conflicts)
            finals, fills = [], []
            for t in range(N):
                val = C_VALS[t][cols[t]]
                idx = t * N + cols[t]
                num = C_target.get_entries()[idx].copy().move_to(C_ent[idx])
                num.set_color(T_COLORS[t])
                finals.append(Transform(sums[t], make_sum(t, f"s={val}")))
                fills.append(Transform(C_ent[idx], num))
            self.play(goto(5), *finals, run_time=rt)
            self.play(
                *fills,
                *[FadeOut(b) for b in col_boxes],
                *[FadeOut(b) for b in c_boxes],
                run_time=rt,
            )

        # ---------- Wrap-up ----------
        self.play(
            FadeOut(hl),
            *[FadeOut(s) for s in sums],
            *[FadeOut(rb) for rb in row_boxes],
        )
        summary = VGroup(
            MathTex(r"27 \text{ multiplications} \,/\, 3 \text{ threads} = 9 \text{ parallel steps}",
                    font_size=32),
            MathTex(r"\text{ideal speedup} = 3\times \quad (\text{each thread owns one row of } C,"
                    r"\text{ so no write conflicts})",
                    font_size=26, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.2)
        summary.move_to(RIGHT * 0.2 + DOWN * 2.4, aligned_edge=LEFT)
        self.play(Write(summary))
        self.wait(2)
