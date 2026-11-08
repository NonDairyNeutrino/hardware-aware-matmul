from manim import *
from common import *

N = 4
R = Q = 2  # output tile: R rows by Q columns
D = 2      # depth of one slice of the shared dimension
A_VALS, B_VALS, C_VALS = example(N)
W_COLORS = [RED_C, BLUE_C]
CODE_AT = LEFT * 6.5 + UP * 0.9


def tile_rc(t):
    """Top-left (row, column) of output tile t; tiles are numbered row by row."""
    return (t // (N // Q)) * R, (t % (N // Q)) * Q


def tile_idx(t):
    r0, c0 = tile_rc(t)
    return [(r0 + i) * N + c0 + j for i in range(R) for j in range(Q)]


def sub(M, r0, c0):
    """The R x Q block of M at (r0, c0), flat."""
    return [M[r0 + i][c0 + j] for i in range(R) for j in range(Q)]


class StreamingMatMul(Scene):
    """Level 5: one output tile at a time, streamed through three small buffers."""

    def construct(self):
        title = Text("Level 5: Streaming Matrix Multiplication", font_size=32)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))
        narr = Narrator(LEFT * 3.2 + DOWN * 2.8)

        # ---------- The problem ----------
        big = VGroup(*[
            VGroup(Square(side_length=1.5, color=col, fill_opacity=0.25),
                   Text(name, font_size=30, color=col),
                   Text("80 GB", font_size=20)).arrange(DOWN, buff=0.1)
            for name, col in (("A", A_COLOR), ("B", B_COLOR), ("C", C_COLOR))
        ]).arrange(RIGHT, buff=0.8).move_to(UP * 0.5)
        for g in big:  # the label and size sit inside the square
            g[1].move_to(g[0].get_center() + UP * 0.2)
            g[2].move_to(g[0].get_center() + DOWN * 0.3)
        self.play(FadeIn(big), narr.say("Levels 0 to 4 keep A, B and C in memory all at once.\n"
                                        "At n = 100 000 each matrix is 80 GB."))
        self.wait(2.5)
        total = Text("3 x 80 GB = 240 GB", font_size=28, color=RED_C).next_to(big, DOWN, buff=0.4)
        self.play(Write(total), narr.say("The arithmetic is not the obstacle. The memory is."))
        self.wait(3)
        self.play(FadeOut(big), FadeOut(total))

        # ---------- The idea: one tile of C ----------
        A, B, C, row, labels = matrices(A_VALS, B_VALS, 0.36, LEFT * 3.3 + UP * 1.9,
                                        h_buff=0.9, v_buff=0.7)
        A_ent, B_ent, C_ent = A.get_entries(), B.get_entries(), C.get_entries()
        ref = A_ent[0]
        code = Code([
            (0, "claim the next output tile T of C"),
            (1, "acc = 0"),
            (1, "for each slice of depth D:"),
            (2, "a = load A tile (rows of T, slice)"),
            (2, "b = load B tile (slice, cols of T)"),
            (2, "acc += a x b"),
            (1, "write T = acc to the output sink"),
        ], CODE_AT)
        self.play(FadeIn(row), FadeIn(labels), FadeIn(code.lines),
                  narr.say("Never compute 'the product'. Compute one tile of C: it\n"
                           "needs only a strip of A (its rows) and a strip of B (its columns)."))
        tile_box = SurroundingRectangle(VGroup(*[C_ent[i] for i in tile_idx(0)]), color=C_COLOR, buff=0.08)
        a_strip = SurroundingRectangle(VGroup(*A_ent[:R * N]), color=A_COLOR, buff=0.08)
        b_strip = SurroundingRectangle(
            VGroup(*[B_ent[i] for i in range(N * N) if i % N < Q]), color=B_COLOR, buff=0.08)
        self.play(code.goto(0), Create(tile_box), Create(a_strip), Create(b_strip))
        self.wait(3)

        # ---------- Three small buffers ----------
        def buf(name, x, color):
            cells = Cells(R, Q, RIGHT * x + UP * 0.5, side=0.55, color=color, init=0)
            lab = Text(name, font_size=18).next_to(cells.group, UP, buff=0.15)
            return cells, lab

        a_buf, a_l = buf("a buffer", 1.4, A_COLOR)
        b_buf, b_l = buf("b buffer", 3.5, B_COLOR)
        acc, acc_l = buf("acc", 5.8, C_COLOR)
        ops = VGroup(MathTex(r"\times", font_size=34).move_to(RIGHT * 2.45 + UP * 0.5),
                     MathTex(r"+\!=", font_size=34).move_to(RIGHT * 4.65 + UP * 0.5))
        self.play(FadeIn(VGroup(a_buf.group, a_l, b_buf.group, b_l, acc.group, acc_l, ops)),
                  code.goto(1),
                  narr.say("The strips are still too big. Stream them through three small\n"
                           "buffers, one slice of depth D = 2 at a time."))
        self.wait(3)

        total_acc = np.zeros((R, Q), dtype=int)
        for s in range(N // D):
            r0, c0 = tile_rc(0)
            a_blk, b_blk = sub(A_VALS, r0, D * s), sub(B_VALS, D * s, c0)
            a_idx = [(r0 + i) * N + D * s + j for i in range(R) for j in range(D)]
            b_idx = [(D * s + i) * N + c0 + j for i in range(D) for j in range(Q)]
            anims = [code.goto(3), *a_buf.set(a_blk), *b_buf.set(b_blk)]
            anims += [A_ent[i].animate.set_color(A_COLOR) for i in a_idx]
            anims += [B_ent[i].animate.set_color(B_COLOR) for i in b_idx]
            if s == 0:
                anims.append(narr.say("Load the A tile and the B tile of this slice\n"
                                      "into the buffers."))
            self.play(*anims)
            self.wait(2.5 if s == 0 else 1)
            total_acc += np.array(a_blk).reshape(R, D) @ np.array(b_blk).reshape(D, Q)
            anims = [code.goto(5), *acc.set(total_acc.flatten().tolist())]
            if s == 0:
                anims.append(narr.say("Multiply them and add the partial product into acc."))
            self.play(*anims)
            self.wait(2.5 if s == 0 else 1)
            self.play(*[A_ent[i].animate.set_color(WHITE) for i in a_idx],
                      *[B_ent[i].animate.set_color(WHITE) for i in b_idx], run_time=0.4)
            if s == 0:
                self.play(code.goto(2), narr.say("Next slice: the same buffers are overwritten.\n"
                                                 "This is an online algorithm: it never holds a whole strip."))
                self.wait(2.5)

        self.play(code.goto(6),
                  *[set_entry(C_ent[i], C_VALS[i // N][i % N], ref, C_COLOR) for i in tile_idx(0)],
                  narr.say("Both slices are in: acc is the finished tile. Hand it to the\n"
                           "output sink (memory, a file, a reduction)."))
        self.wait(3)
        self.play(*[C_ent[i].animate.set_color(WHITE) for i in tile_idx(0)],
                  FadeOut(a_strip), FadeOut(b_strip), FadeOut(tile_box),
                  narr.say("Memory used: three small tiles, however large n is."))
        self.wait(3)

        # ---------- Dynamic work distribution ----------
        self.play(*code.hide(), FadeOut(VGroup(a_buf.group, a_l, b_buf.group, b_l, acc.group, acc_l, ops)))
        tiles = Cells(2, 2, RIGHT * 5.8 + DOWN * 0.3, side=0.8, init=["T0", "T1", "T2", "T3"], font_size=26)
        tiles_l = Text("output tiles", font_size=18).next_to(tiles.group, UP, buff=0.15)

        def counter_text(n):
            return Text(f"atomic counter: next = {n}", font_size=20, font="Monospace").move_to(
                RIGHT * 0.3 + UP * 0.5, aligned_edge=LEFT)

        counter = counter_text(1)
        workers = [Text(f"worker {w + 1}", font_size=20, color=W_COLORS[w]).move_to(
            RIGHT * 0.3 + DOWN * (0.3 + 0.5 * w), aligned_edge=LEFT) for w in range(2)]
        self.play(FadeIn(tiles.group), FadeIn(tiles_l), FadeIn(counter), FadeIn(VGroup(*workers)),
                  tiles.cells[0].animate.set_fill(W_COLORS[0], opacity=0.5),
                  narr.say("Many workers run this loop at once, each with its own three\n"
                           "buffers. Tile 0 was worker 1's; the counter says what is next."))
        self.wait(3.5)

        def claim(w, t, n_next, msg=None):
            """Worker w claims tile t, finishes it, and the counter moves on to n_next."""
            anims = [tiles.cells[t].animate.set_fill(W_COLORS[w], opacity=0.5),
                     Transform(counter, counter_text(n_next)),
                     *[set_entry(C_ent[i], C_VALS[i // N][i % N], ref, W_COLORS[w]) for i in tile_idx(t)]]
            if msg:
                anims.append(narr.say(msg))
            self.play(*anims)
            self.wait(2.5 if msg else 0.8)
            self.play(*[C_ent[i].animate.set_color(WHITE) for i in tile_idx(t)], run_time=0.4)

        claim(1, 1, 2, "Worker 2 is free too: it claims tile 1 and the counter moves on.")
        claim(0, 2, 3, "Worker 1 finishes first and just takes the next tile.\n"
                       "No fixed split: nobody waits for a slow worker.")
        claim(1, 3, 4)
        self.wait(1)

        summary = VGroup(
            Text("memory: three small tile buffers per worker", font_size=17, color=WHITE),
            Text("inputs and outputs can be files, not just matrices", font_size=17, color=GREY_B),
            Text("each tile is summed in increasing k: same results", font_size=17, color=GREY_B),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
        summary.move_to(RIGHT * 0.5 + DOWN * 1.9, aligned_edge=UL)
        self.play(Write(summary),
                  narr.say("Level 5 makes the product possible when the matrices\n"
                           "do not fit in memory, with identical results."))
        self.wait(3)
