from manim import *
from common import *

# 4 x 4 (not 3 x 3): the register has 4 f64 lanes (AVX), so a row of B fills it exactly.
N = 4
NR = 4  # lanes = columns of the micro-tile
MR = 2  # rows of the micro-tile
A_VALS, B_VALS, C_VALS = example(N)
CODE_AT = LEFT * 6.5 + UP * 0.9
LANES_X = 4.6  # centre of the lane grids on the right-hand side


class SimdMatMul(Scene):
    """Level 3: a block of C lives in vector registers for the whole k loop."""

    def construct(self):
        title = Text("Level 3: SIMD Matrix Multiplication", font_size=32)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))

        A, B, C, row, labels = matrices(A_VALS, B_VALS, 0.36, LEFT * 3.3 + UP * 1.9,
                                        h_buff=0.9, v_buff=0.7)
        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        ref = A_ent[0]
        self.play(FadeIn(row), FadeIn(labels))
        narr = Narrator(LEFT * 3.2 + DOWN * 2.8)

        # ---------- The cost of level 2's inner step ----------
        code2 = Code([
            (0, "for k in k_block:"),
            (1, "alpha = A[i][k]"),
            (1, "for j in j_block:"),
            (2, "C[i][j] += alpha * B[k][j]"),
        ], CODE_AT)
        self.play(FadeIn(code2.lines), code2.goto(3),
                  narr.say("Level 2's inner step: load a segment of B, load a segment\n"
                           "of C, do one multiply-add, store the segment of C."))

        def box(text, pos, color):
            r = Rectangle(width=2.3, height=0.7, color=color)
            return VGroup(r, Text(text, font_size=18).move_to(r)).move_to(pos)

        b_box = box("B[k][j..]", RIGHT * 2.2 + UP * 1.2, B_COLOR)
        c_box = box("C[i][j..]", RIGHT * 2.2 + DOWN * 0.6, C_COLOR)
        fma = VGroup(Circle(radius=0.45, color=WHITE), MathTex(r"\times +", font_size=30))
        fma.move_to(RIGHT * 5.6 + UP * 0.3)
        arrows = [
            Arrow(b_box.get_right(), fma.get_top() + LEFT * 0.15, buff=0.1, color=GREY_B),
            Arrow(c_box.get_right() + UP * 0.2, fma.get_left() + DOWN * 0.05, buff=0.1, color=GREY_B),
            Arrow(fma.get_bottom() + LEFT * 0.15, c_box.get_right() + DOWN * 0.2, buff=0.1, color=RED_C),
        ]
        tags = [Text(t, font_size=16, color=c).next_to(a, d, buff=0.05)
                for t, c, a, d in zip(("load", "load", "store"), (GREY_B, GREY_B, RED_C),
                                      arrows, (UP, DOWN, DOWN))]
        tags[1].move_to(arrows[1].get_center() + UP * 0.3 + LEFT * 0.35)  # keep clear of the store arrow
        self.play(FadeIn(b_box), FadeIn(c_box), FadeIn(fma))
        self.wait(1.5)
        for a, t in zip(arrows, tags):
            self.play(Create(a), FadeIn(t), run_time=0.8)
        tally = Text("2 loads + 1 store for every multiply-add", font_size=20, color=RED_C)
        tally.move_to(RIGHT * 4.0 + DOWN * 1.8)
        self.play(Write(tally), narr.say("The arithmetic cannot go faster than the data arrives, even\n"
                                         "when every access hits the cache."))
        self.wait(3.5)
        self.play(narr.say("The fix: stop moving C through memory on every k.\n"
                           "Keep a block of C in vector registers instead."))
        self.wait(3)
        self.play(*[FadeOut(m) for m in (b_box, c_box, fma, tally, *arrows, *tags)])

        # ---------- Vector registers ----------
        code3 = Code([
            (0, "acc[r] = 0       # MR rows of C"),
            (0, "for k in 0..n:"),
            (1, "vb = load(B[k][j..j+NR])"),
            (1, "for r in 0..MR:"),
            (2, "va = splat(A[i+r][k])"),
            (2, "acc[r] += va * vb"),
            (0, "store(C[i..][j..], acc)"),
        ], CODE_AT)
        self.play(*code2.hide(), FadeIn(code3.lines),
                  narr.say("A SIMD register holds several numbers, one per lane.\n"
                           "One instruction works on all lanes at once."))
        self.wait(2.5)

        def lane_row(name, y, color, init):
            cells = Cells(1, NR, RIGHT * LANES_X + UP * y, side=0.6, color=color, init=init)
            lab = Text(name, font_size=18).next_to(cells.group, LEFT, buff=0.25)
            return cells, lab

        vb, vb_l = lane_row("vb = B[k][0..4]", 1.5, B_COLOR, r"\cdot")
        va, va_l = lane_row("va = A[i][k] in every lane", 0.6, A_COLOR, r"\cdot")
        acc = [lane_row(f"acc{r} = C[{r}][0..4]", -0.4 - 0.9 * r, C_COLOR, 0) for r in range(MR)]
        regs = VGroup(vb.group, vb_l, va.group, va_l, *[g for pair in acc for g in (pair[0].group, pair[1])])
        tile = SurroundingRectangle(VGroup(*C_ent[:MR * N]), color=C_COLOR, buff=0.06)
        self.play(FadeIn(regs), Create(tile),
                  narr.say("Take a micro-tile of C: 2 rows by 4 columns. The 4 columns\n"
                           "are the lanes. It lives in two accumulator registers."))
        self.wait(3)

        sums = [[0] * NR for _ in range(MR)]
        for k in range(N):
            rt = 1.0 if k == 0 else 0.5
            b_idx = [k * N + j for j in range(NR)]
            anims = [code3.goto(2), *vb.set(B_VALS[k])]
            anims += [B_ent[i].animate.set_color(B_COLOR) for i in b_idx]
            if k == 0:
                anims.append(narr.say(f"For each k, load row k of B into a vector register, once."))
            self.play(*anims, run_time=rt)
            self.wait(2 if k == 0 else 0.2)
            for r in range(MR):
                a = A_VALS[r][k]
                anims = [code3.goto(4), *va.set([a] * NR), A_ent[r * N + k].animate.set_color(A_COLOR)]
                if k == 0 and r == 0:
                    anims.append(narr.say("Broadcast A[i][k] into every lane of va."))
                self.play(*anims, run_time=rt)
                self.wait(1.5 if (k == 0 and r == 0) else 0.1)
                for l in range(NR):
                    sums[r][l] += a * B_VALS[k][l]
                anims = [code3.goto(5), *acc[r][0].set(sums[r])]
                if k == 0 and r == 0:
                    anims.append(narr.say("One vector multiply-add: every lane does\n"
                                          "acc += va * vb at the same time."))
                self.play(*anims, run_time=rt)
                self.wait(2.5 if (k == 0 and r == 0) else 0.1)
                self.play(A_ent[r * N + k].animate.set_color(WHITE), run_time=0.2)
            self.play(*[B_ent[i].animate.set_color(WHITE) for i in b_idx], run_time=0.2)
            if k == 0:
                self.play(narr.say("Repeat for k = 1, 2, 3. The accumulators never\n"
                                   "leave the registers: no loads or stores of C."))
                self.wait(2.5)

        # ---------- Store ----------
        self.play(code3.goto(6),
                  *[set_entry(C_ent[r * N + l], sums[r][l], ref, C_COLOR)
                    for r in range(MR) for l in range(NR)],
                  narr.say("After the k loop, store the accumulators into C: one store\n"
                           "per element, not one per k."))
        self.wait(3)
        self.play(*[C_ent[i].animate.set_color(WHITE) for i in range(MR * N)],
                  FadeOut(tile), narr.say("The next micro-tile (rows 2 and 3) works the same way."))
        self.play(*[set_entry(C_ent[i], C_VALS[i // N][i % N], ref) for i in range(MR * N, N * N)],
                  run_time=1.5)
        self.wait(1.5)

        # ---------- Wrap-up ----------
        summary = VGroup(
            Text("C stays in registers for the whole k loop", font_size=17, color=WHITE),
            Text("B: one vector load per k; C: one store at the end", font_size=17, color=GREY_B),
            Text("each lane is one element of C, summed in increasing k", font_size=17, color=GREY_B),
            Text("so the result is bit-identical to levels 0 to 2", font_size=17, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        summary.move_to(RIGHT * 0.5 + DOWN * 2.0, aligned_edge=UL)
        self.play(*code3.hide(), Write(summary),
                  narr.say("Lane widths: 2 (SSE2, NEON, WASM SIMD128), 4 (AVX2),\n"
                           "8 (AVX-512). Same idea at every width."))
        self.wait(3)
