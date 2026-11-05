from manim import *
import numpy as np

N = 3
A_VALS = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
B_VALS = [[9, 8, 7], [6, 5, 4], [3, 2, 1]]
C_VALS = (np.array(A_VALS) @ np.array(B_VALS)).tolist()

A_COLOR = YELLOW
B_COLOR = BLUE
C_COLOR = GREEN


class NaiveMatMul(Scene):
    def construct(self):
        # ---------- Title ----------
        title = Text("Naive Matrix Multiplication", font_size=36).to_edge(UP, buff=0.3)
        self.play(Write(title))

        # ---------- Matrices:  A x B = C ----------
        mat_kw = dict(h_buff=1.0, v_buff=0.8)
        A = Matrix(A_VALS, **mat_kw)
        B = Matrix(B_VALS, **mat_kw)
        C = Matrix([["?"] * N for _ in range(N)], **mat_kw)
        C_target = Matrix(C_VALS, **mat_kw)  # never shown; used as number templates

        row = VGroup(A, MathTex(r"\times"), B, MathTex("="), C).arrange(RIGHT, buff=0.3)
        row.scale(0.6).move_to(UP * 1.2)
        C_target.scale(0.6).move_to(C)

        labels = VGroup(
            MathTex("A", color=A_COLOR).next_to(A, UP, buff=0.2),
            MathTex("B", color=B_COLOR).next_to(B, UP, buff=0.2),
            MathTex("C", color=C_COLOR).next_to(C, UP, buff=0.2),
        )
        self.play(FadeIn(row), FadeIn(labels))

        # ---------- Pseudocode ----------
        spec = [
            (0, "for i in 1..n:"),
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
            return SurroundingRectangle(lines[idx], color=ORANGE, buff=0.06)

        hl = box_for(0)
        self.play(Create(hl))

        def goto(idx):
            return Transform(hl, box_for(idx))

        # ---------- Running-sum readout ----------
        anchor = RIGHT * 0.5 + DOWN * 2.3

        def make_sum(s):
            return MathTex(s, font_size=36).move_to(anchor, aligned_edge=LEFT)

        sum_tex = make_sum("s=0")

        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        A_rows, B_cols = A.get_rows(), B.get_columns()
        first = True

        # ---------- The triple loop ----------
        for i in range(N):
            for j in range(N):
                fast = not (i == 0 and j == 0)
                t = 0.25 if fast else 0.9

                # i / j loop headers
                row_box = SurroundingRectangle(A_rows[i], color=A_COLOR, buff=0.1)
                col_box = SurroundingRectangle(B_cols[j], color=B_COLOR, buff=0.1)
                c_box = SurroundingRectangle(C_ent[i * N + j], color=C_COLOR, buff=0.1)

                if j == 0:
                    self.play(goto(0), run_time=t)
                self.play(
                    goto(1),
                    Create(row_box), Create(col_box), Create(c_box),
                    run_time=t,
                )

                # s = 0
                new_sum = make_sum("s=0")
                if first:
                    self.play(goto(2), FadeIn(sum_tex), run_time=t)
                else:
                    self.play(goto(2), Transform(sum_tex, new_sum), run_time=t)

                # inner k loop: dot product of row i of A with column j of B
                terms = []
                for k in range(N):
                    self.play(goto(3), run_time=t * 0.5)
                    a, b = A_ent[i * N + k], B_ent[k * N + j]
                    terms.append(f"{A_VALS[i][k]}\\cdot{B_VALS[k][j]}")
                    self.play(
                        goto(4),
                        a.animate.set_color(A_COLOR).scale(1.25),
                        b.animate.set_color(B_COLOR).scale(1.25),
                        Transform(sum_tex, make_sum("s=" + "+".join(terms))),
                        run_time=t,
                    )
                    self.play(
                        a.animate.set_color(WHITE).scale(1 / 1.25),
                        b.animate.set_color(WHITE).scale(1 / 1.25),
                        run_time=t * 0.4,
                    )

                # C[i,j] = s
                val = C_VALS[i][j]
                num = C_target.get_entries()[i * N + j].copy().move_to(C_ent[i * N + j])
                num.set_color(C_COLOR)
                self.play(
                    goto(5),
                    Transform(sum_tex, make_sum(f"s={val}")),
                    run_time=t,
                )
                self.play(
                    Transform(C_ent[i * N + j], num),
                    FadeOut(row_box), FadeOut(col_box), FadeOut(c_box),
                    run_time=t,
                )
                first = False

        # ---------- Wrap-up ----------
        self.play(FadeOut(hl), FadeOut(sum_tex))
        summary = VGroup(
            MathTex(r"n^2 \text{ entries of } C", font_size=34),
            MathTex(r"\times\; n \text{ multiply-adds each}", font_size=34),
            MathTex(r"= n^3 = 27 \text{ multiplications} \;\Rightarrow\; O(n^3)",
                    font_size=34, color=C_COLOR),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.2).move_to(anchor, aligned_edge=LEFT)
        self.play(Write(summary))
        self.wait(2)
