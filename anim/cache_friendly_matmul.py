from manim import *
from common import *

N = 3
LINE = 3  # cache-line size in elements (illustrative; a real 64 B line = 8 doubles)
A_VALS, B_VALS, C_VALS = example(N)
RED = RED_C
CODE_AT = RIGHT * 0.4 + UP * 2.3


class CacheFriendlyMatMul(Scene):
    """Level 2: loop order i-k-j, then cache blocking. Memory is row-major, as in the crate."""

    def construct(self):
        title = Text("Level 2: Cache-Friendly Matrix Multiplication", font_size=30)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))

        A, B, C, row, labels = matrices(A_VALS, B_VALS, 0.5, LEFT * 3.3 + UP * 1.9)
        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        ref = A_ent[0]
        self.play(FadeIn(row), FadeIn(labels))

        Bs = Strip("B", B_VALS, LEFT * 3.0 + UP * 0.2, LINE)
        Cs = Strip("C", [[0] * N] * N, LEFT * 3.0 + DOWN * 0.6, LINE)
        caption = Text("memory, row-major  |  one cache line = one row = 3 elements",
                       font_size=18, color=GREY_B).move_to(LEFT * 3.2 + UP * 0.78)
        narr = Narrator(LEFT * 3.2 + DOWN * 2.8)
        self.play(FadeIn(Bs.group), FadeIn(Cs.group), FadeIn(caption),
                  narr.say("Arrays live in memory row by row (row-major).\n"
                           "The CPU fetches memory a whole cache line at a time."))
        self.wait(2.5)

        def set_c(values, color=WHITE):
            """Animations that put the 3x3 `values` into C, in the matrix and in memory."""
            out = []
            for i in range(N):
                for j in range(N):
                    out += [set_entry(C_ent[i * N + j], values[i][j], ref, color),
                            Cs.set(i * N + j, values[i][j])]
            return out

        # ---------- Change 0: the old order, i-j-k ----------
        code1 = Code([
            (0, "for i in 0..n:"),
            (1, "for j in 0..n:"),
            (2, "for k in 0..n:"),
            (3, "sum += A[i][k] * B[k][j]"),
            (2, "C[i][j] = sum"),
        ], CODE_AT)
        self.play(FadeIn(code1.lines), code1.goto(3),
                  narr.say("Levels 0 and 1 compute C[i][j] as a dot product:\n"
                           "a row of A against a column of B."))
        self.wait(2)
        for k in range(N):
            idx = k * N  # B[k][0]
            anims = [
                A_ent[k].animate.set_color(A_COLOR),
                B_ent[idx].animate.set_color(B_COLOR),
                Bs.cells[idx].animate.set_fill(B_COLOR, opacity=0.6),
                Indicate(Bs.lines[k], color=RED, scale_factor=1.12),
            ]
            if k == 0:
                anims.append(narr.say("Walking down column 0 of B reads elements 0, 3, 6:\n"
                                      "a different cache line every time."))
            self.play(*anims, run_time=1.0 if k == 0 else 0.6)
            self.wait(1.5 if k == 0 else 0.4)
        self.play(narr.say("Two of the three elements in each fetched line go unused.\n"
                           "For large matrices that is almost a miss per multiply."))
        self.wait(3)
        self.play(
            *[A_ent[k].animate.set_color(WHITE) for k in range(N)],
            *[B_ent[k * N].animate.set_color(WHITE) for k in range(N)],
            *[Bs.cells[k * N].animate.set_fill(opacity=0) for k in range(N)],
        )

        # ---------- Change 1: loop order i-k-j ----------
        code2 = Code([
            (0, "for i in 0..n:"),
            (1, "for k in 0..n:"),
            (2, "alpha = A[i][k]"),
            (2, "for j in 0..n:  # contiguous"),
            (3, "C[i][j] += alpha * B[k][j]"),
        ], CODE_AT)
        self.play(*code1.hide(), FadeIn(code2.lines),
                  narr.say("Same additions, different order: i-k-j.\n"
                           "Take one element of A and scale a whole row of B."))
        self.wait(2.5)

        acc = [0] * N  # row 0 of C
        for k in range(N):
            rt = 1.0 if k == 0 else 0.5
            self.play(code2.goto(2), A_ent[k].animate.set_color(A_COLOR), run_time=rt)
            b_idx = [k * N + j for j in range(N)]
            c_idx = list(range(N))  # row 0 of C
            anims = [code2.goto(4), Indicate(Bs.lines[k], color=RED, scale_factor=1.12)]
            anims += [B_ent[i].animate.set_color(B_COLOR) for i in b_idx]
            anims += [Bs.cells[i].animate.set_fill(B_COLOR, opacity=0.6) for i in b_idx]
            anims += [C_ent[i].animate.set_color(C_COLOR) for i in c_idx]
            anims += [Cs.cells[i].animate.set_fill(C_COLOR, opacity=0.6) for i in c_idx]
            if k == 0:
                anims.append(narr.say("Row k of B is one cache line, read from start to end.\n"
                                      "Row 0 of C is one line too: accumulate into it."))
            self.play(*anims, run_time=rt)
            self.wait(2 if k == 0 else 0.3)
            for j in range(N):
                acc[j] += A_VALS[0][k] * B_VALS[k][j]
            self.play(*[a for j in range(N)
                        for a in (set_entry(C_ent[j], acc[j], ref, C_COLOR), Cs.set(j, acc[j]))],
                      run_time=rt)
            self.play(
                A_ent[k].animate.set_color(WHITE),
                *[B_ent[i].animate.set_color(WHITE) for i in b_idx],
                *[C_ent[i].animate.set_color(WHITE) for i in c_idx],
                *[Bs.cells[i].animate.set_fill(opacity=0) for i in b_idx],
                *[Cs.cells[i].animate.set_fill(opacity=0) for i in c_idx],
                run_time=rt * 0.5,
            )
        self.play(narr.say("Every line fetched is used completely.\n"
                           "The same happens for rows i = 1 and 2 of C."))
        self.wait(2)
        self.play(*set_c(C_VALS), run_time=1.0)
        self.wait(1.5)

        # ---------- Change 2: cache blocking ----------
        KB = JB = 2  # illustrative block; the crate uses 32 x 64
        self.play(*set_c([[0] * N] * N), run_time=0.8)
        code3 = Code([
            (0, "for k0 in 0..n step KB:"),
            (1, "for j0 in 0..n step JB:"),
            (2, "for i in rows:  # same B block"),
            (3, "for k in k0..k0+KB:"),
            (4, "axpy(A[i][k], B[k], C[i])"),
        ], CODE_AT)
        self.play(*code2.hide(), FadeIn(code3.lines),
                  narr.say("For big matrices row k of B is evicted before the next i\n"
                           "needs it. Blocking reuses a small block of B for every row."))
        self.wait(3)
        block = [k * N + j for k in range(KB) for j in range(JB)]
        box = SurroundingRectangle(VGroup(*[B_ent[i] for i in block]), color=RED, buff=0.08)
        self.play(Create(box), code3.goto(2),
                  *[Bs.cells[i].animate.set_fill(B_COLOR, opacity=0.35) for i in block],
                  narr.say("Take a 2 x 2 block of B (the crate uses 32 x 64 doubles,\n"
                           "16 KiB, which fits a typical L1 data cache)."))
        self.wait(3)
        part = [[0] * N for _ in range(N)]
        for i in range(N):
            for j in range(JB):
                part[i][j] = sum(A_VALS[i][k] * B_VALS[k][j] for k in range(KB))
            a_idx = [i * N + k for k in range(KB)]
            c_idx = [i * N + j for j in range(JB)]
            anims = [code3.goto(4)]
            anims += [A_ent[x].animate.set_color(A_COLOR) for x in a_idx]
            anims += [C_ent[x].animate.set_color(C_COLOR) for x in c_idx]
            if i == 0:
                anims.append(narr.say("Row i of A meets the block that is already in cache,\n"
                                      "and updates the matching part of row i of C."))
            self.play(*anims, run_time=0.8)
            self.wait(2 if i == 0 else 0.2)
            self.play(*[a for j in range(JB)
                        for a in (set_entry(C_ent[i * N + j], part[i][j], ref, C_COLOR),
                                  Cs.set(i * N + j, part[i][j]))], run_time=0.6)
            self.play(*[A_ent[x].animate.set_color(WHITE) for x in a_idx],
                      *[C_ent[x].animate.set_color(WHITE) for x in c_idx], run_time=0.3)
        self.play(narr.say("The block is loaded once and reused for every row i.\n"
                           "Then the next blocks of B, until all of C is done."))
        self.wait(2)
        self.play(FadeOut(box), *set_c(C_VALS),
                  *[Bs.cells[i].animate.set_fill(opacity=0) for i in block])
        self.wait(1)

        # ---------- Wrap-up ----------
        summary = VGroup(
            Text("i-k-j: both inner reads are contiguous", font_size=17, color=WHITE),
            Text("blocking: a block of B is reused for every row", font_size=17, color=GREY_B),
            Text("same threads and row blocks as level 1", font_size=17, color=GREY_B),
            Text("same sums in the same order: identical results", font_size=17, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        summary.move_to(RIGHT * 0.4 + DOWN * 1.8, aligned_edge=UL)
        self.play(*code3.hide(), Write(summary),
                  narr.say("Level 2: the same arithmetic, rearranged so that every\n"
                           "fetched cache line is used while it is still cached."))
        self.wait(3)
