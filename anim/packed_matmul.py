from manim import *
from common import *

# A 4 x 4 example with a micro-tile of 2 rows by 2 columns, so that a strip of B (two
# columns) is narrower than a row of B and the strided read is visible. The crate's strip is
# NR = 4 (SSE2) or 8 (AVX) columns wide; the idea does not depend on the width.
N = 4
NR = 2     # columns of the micro-tile = lanes = width of a strip of B
MR = 2     # rows of the micro-tile
LINE = 4   # doubles per drawn cache line: one row of B
A_VALS, B_VALS, C_VALS = example(N)
CODE_AT = LEFT * 6.5 + UP * 0.9
MEM_X = 4.2  # centre of the memory strips on the right-hand side


def strip_values(j0):
    """B's strip of columns j0.. in packed order: k by k, NR values each."""
    return [B_VALS[k][j0 + l] for k in range(N) for l in range(NR)]


class PackedMatMul(Scene):
    """Level 4: copy each strip of B into a contiguous buffer before the vector kernel reads it."""

    def construct(self):
        title = Text("Level 4: Packing B", font_size=32)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))

        A, B, C, row, labels = matrices(A_VALS, B_VALS, 0.36, LEFT * 3.3 + UP * 1.9,
                                        h_buff=0.9, v_buff=0.7)
        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        ref = A_ent[0]
        self.play(FadeIn(row), FadeIn(labels))
        narr = Narrator(LEFT * 3.2 + DOWN * 2.8)

        # ---------- A strip of B, read in place ----------
        Bs = Strip("B", B_VALS, RIGHT * MEM_X + UP * 1.9, LINE, side=0.32)
        caption = Text("row-major  |  one cache line = one row = 4 elements",
                       font_size=16, color=GREY_B).next_to(Bs.group, DOWN, buff=0.15).align_to(Bs.group, RIGHT)
        self.play(FadeIn(Bs.group), FadeIn(caption),
                  narr.say("Level 3's micro-kernel reads a strip of B: NR columns, for\n"
                           "every k. Here NR = 2, so the strip is columns 0 and 1."))
        self.wait(2.5)

        def counter(text, color):
            return Text(text, font_size=20, color=color).move_to(RIGHT * MEM_X + UP * 0.55)

        tally = counter("cache lines touched: 0", GREY_B)
        self.play(FadeIn(tally))
        for k in range(N):
            anims = [Bs.cells[k * N + l].animate.set_fill(B_COLOR, opacity=0.7) for l in range(NR)]
            anims += [B_ent[k * N + l].animate.set_color(B_COLOR) for l in range(NR)]
            anims.append(Bs.lines[k].animate.set_color(RED_C))
            anims.append(Transform(tally, counter(f"cache lines touched: {k + 1}", RED_C)))
            if k == 0:
                anims.append(narr.say("Step k = 0 reads B[0][0] and B[0][1]: part of one cache line."))
            if k == 1:
                anims.append(narr.say("Step k = 1 is a whole row further on: a different cache line."))
            self.play(*anims, run_time=1.0 if k < 2 else 0.6)
            self.wait(2.0 if k < 2 else 0.3)
        self.play(narr.say("Four steps, four cache lines, and only half of each line is used.\n"
                           "With a long row each line is also on a different page."))
        self.wait(3.5)

        # ---------- Pack it ----------
        self.play(narr.say("Packing copies the strip into a small contiguous buffer, k by k,\n"
                           "before the kernel runs."))
        self.wait(2.5)
        Ps = Strip("packed", [[r"\cdot"] * (N * NR)], RIGHT * MEM_X + DOWN * 0.7, LINE, side=0.32)
        Ps.group.remove(*Ps.txts)  # the slots start empty; the copied values are added as they arrive
        Ps.txts = [None] * (N * NR)
        ptally = Text("cache lines touched: 0", font_size=20, color=GREY_B).move_to(RIGHT * MEM_X + DOWN * 1.5)
        self.play(FadeIn(Ps.group), FadeIn(ptally))
        for k in range(N):
            moving = []
            for l in range(NR):
                src = Bs.txts[k * N + l]
                moving.append(src.copy())
            self.add(*moving)
            anims = [m.animate.move_to(Ps.cells[k * NR + l]) for l, m in enumerate(moving)]
            if k == 0:
                anims.append(narr.say("Strip row k = 0 goes to slots 0 and 1, k = 1 to slots 2 and 3,\n"
                                      "and so on: the values are adjacent in the buffer."))
            self.play(*anims, run_time=1.0 if k == 0 else 0.5)
            for l, m in enumerate(moving):
                Ps.txts[k * NR + l] = m
            if k >= 1:
                self.play(Ps.lines[(k * NR) // LINE].animate.set_color(GREEN_C),
                          Transform(ptally, Text(f"cache lines touched: {(k * NR) // LINE + 1}", font_size=20,
                                                 color=GREEN_C).move_to(ptally)), run_time=0.3)
            self.wait(1.5 if k == 0 else 0.2)
        self.play(narr.say("Eight values, two cache lines, all of each used. The copy\n"
                           "only moves values: nothing is added or reordered."))
        self.wait(3.5)

        # ---------- The kernel reads the buffer ----------
        code = Code([
            (0, "for each block of B (k-block, j-block):"),
            (1, "pack its strips into contiguous buffers"),
            (1, "for each strip:"),
            (2, "for each row group of A:"),
            (3, "micro_kernel(A rows, packed strip, C)"),
        ], CODE_AT, font_size=17)
        packed_group = VGroup(Ps.group, *Ps.txts)
        self.remove(Ps.group, *Ps.txts)  # one group from here on, so it moves as one
        self.add(packed_group)
        self.play(FadeOut(Bs.group), FadeOut(caption), FadeOut(tally),
                  *[e.animate.set_color(WHITE) for e in B_ent],
                  FadeIn(code.lines), code.goto(4),
                  packed_group.animate.move_to(RIGHT * MEM_X + UP * 1.9),
                  ptally.animate.move_to(RIGHT * MEM_X + UP * 1.1),
                  narr.say("The micro-kernel is level 3's, unchanged. Its row of B is now\n"
                           "NR values read straight from the buffer."))
        self.wait(3)

        def lane_row(name, y, color, init):
            cells = Cells(1, NR, RIGHT * MEM_X + UP * y, side=0.6, color=color, init=init)
            lab = Text(name, font_size=18).next_to(cells.group, LEFT, buff=0.25)
            return cells, lab

        vb, vb_l = lane_row("vb = packed[k]", 0.2, B_COLOR, r"\cdot")
        va, va_l = lane_row("va = A[i][k] in every lane", -0.7, A_COLOR, r"\cdot")
        acc = [lane_row(f"acc{r} = C[{r}][0..2]", -1.6 - 0.9 * r, C_COLOR, 0) for r in range(MR)]
        regs = VGroup(vb.group, vb_l, va.group, va_l, *[g for pair in acc for g in (pair[0].group, pair[1])])
        tile = SurroundingRectangle(VGroup(*[C_ent[r * N + l] for r in range(MR) for l in range(NR)]),
                                    color=C_COLOR, buff=0.06)
        self.play(FadeIn(regs), Create(tile),
                  narr.say("The micro-tile is 2 rows by NR columns of C, held in\n"
                           "registers for the whole k loop."))
        self.wait(2.5)

        sums = [[0] * NR for _ in range(MR)]
        for k in range(N):
            slots = [k * NR + l for l in range(NR)]
            anims = [*vb.set([B_VALS[k][l] for l in range(NR)])]
            anims += [Ps.cells[s].animate.set_fill(B_COLOR, opacity=0.7) for s in slots]
            if k == 0:
                anims.append(narr.say("Load NR adjacent values from the buffer: one vector load."))
            self.play(*anims, run_time=1.0 if k == 0 else 0.5)
            self.wait(2 if k == 0 else 0.2)
            for r in range(MR):
                a = A_VALS[r][k]
                for l in range(NR):
                    sums[r][l] += a * B_VALS[k][l]
                anims = [*va.set([a] * NR), *acc[r][0].set(sums[r]),
                         A_ent[r * N + k].animate.set_color(A_COLOR)]
                if k == 0 and r == 0:
                    anims.append(narr.say("Broadcast A[i][k], then acc += va * vb in every lane."))
                self.play(*anims, run_time=0.8 if (k == 0 and r == 0) else 0.4)
                self.wait(2 if (k == 0 and r == 0) else 0.1)
                self.play(A_ent[r * N + k].animate.set_color(WHITE), run_time=0.15)
            self.play(*[Ps.cells[s].animate.set_fill(B_COLOR, opacity=0.0) for s in slots], run_time=0.15)

        # ---------- Store, then reuse ----------
        self.play(*[set_entry(C_ent[r * N + l], sums[r][l], ref, C_COLOR) for r in range(MR) for l in range(NR)],
                  narr.say("After the k loop, store the accumulators into C."))
        self.wait(3)
        rows_b = [r for r in range(MR, N)]
        tile_b = SurroundingRectangle(VGroup(*[C_ent[r * N + l] for r in rows_b for l in range(NR)]),
                                      color=C_COLOR, buff=0.06)
        self.play(*[C_ent[r * N + l].animate.set_color(WHITE) for r in range(MR) for l in range(NR)],
                  Transform(tile, tile_b),
                  narr.say("The next row group of A, rows 2 and 3, reads the same buffer.\n"
                           "The copy is paid once and used once per row group."))
        self.wait(2.5)
        self.play(*[set_entry(C_ent[r * N + l], C_VALS[r][l], ref, C_COLOR) for r in rows_b for l in range(NR)],
                  run_time=1.5)
        self.wait(2)

        # ---------- The next strip ----------
        self.play(*[C_ent[r * N + l].animate.set_color(WHITE) for r in rows_b for l in range(NR)],
                  FadeOut(tile),
                  narr.say("The next strip, columns 2 and 3, is packed into the same buffer\n"
                           "and read the same way."))
        self.wait(2.5)
        self.play(*vb.set([r"\cdot"] * NR), *va.set([r"\cdot"] * NR),
                  *[a.set([0] * NR)[i] for a, _ in acc for i in range(NR)], run_time=0.8)
        self.play(*[B_ent[k * N + NR + l].animate.set_color(B_COLOR) for k in range(N) for l in range(NR)],
                  *[Transform(Ps.txts[k * NR + l],
                              MathTex(str(B_VALS[k][NR + l]), font_size=22).move_to(Ps.cells[k * NR + l]))
                    for k in range(N) for l in range(NR)], run_time=1.5)
        self.wait(1.5)
        self.play(*[set_entry(C_ent[r * N + NR + l], C_VALS[r][NR + l], ref, WHITE)
                    for r in range(N) for l in range(NR)],
                  *[B_ent[i].animate.set_color(WHITE) for i in range(N * N)], run_time=1.5)
        self.wait(1.5)

        # ---------- Wrap-up ----------
        summary = VGroup(
            Text("a strip of B is copied once into a contiguous buffer", font_size=17, color=WHITE),
            Text("then read once per row group of A, k by k, from adjacent memory", font_size=17, color=GREY_B),
            Text("the copy moves values and changes no arithmetic", font_size=17, color=GREY_B),
            Text("so the result is bit-identical to levels 0 to 3", font_size=17, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        summary.move_to(LEFT * 6.5 + DOWN * 0.3, aligned_edge=UL)
        self.play(*code.hide(), FadeOut(regs), FadeOut(packed_group), FadeOut(ptally), Write(summary),
                  narr.say("Whether the copy pays for itself is a measurement:\n"
                           "it did at the largest size on the reference machine."))
        self.wait(3.5)
