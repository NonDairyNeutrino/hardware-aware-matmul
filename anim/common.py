"""Helpers shared by the level 2, 3 and 4 scenes (the older scenes are self-contained)."""
from manim import *
import numpy as np

A_COLOR = YELLOW
B_COLOR = BLUE
C_COLOR = GREEN


def example(n):
    """A = 1..n^2 row by row, B = n^2..1, C = A @ B. For n = 3 this is the example of the older scenes."""
    A = [[n * i + j + 1 for j in range(n)] for i in range(n)]
    B = [[n * n - (n * i + j) for j in range(n)] for i in range(n)]
    return A, B, (np.array(A) @ np.array(B)).tolist()


def matrices(A_vals, B_vals, scale, center, h_buff=1.0, v_buff=0.8):
    """The row `A x B = C` with C all zeros, plus the A / B / C labels."""
    n = len(A_vals)
    kw = dict(h_buff=h_buff, v_buff=v_buff)
    A, B = Matrix(A_vals, **kw), Matrix(B_vals, **kw)
    C = Matrix([[0] * n for _ in range(n)], **kw)
    row = VGroup(A, MathTex(r"\times"), B, MathTex("="), C).arrange(RIGHT, buff=0.3)
    row.scale(scale).move_to(center)
    labels = VGroup(
        MathTex("A", color=A_COLOR).next_to(A, UP, buff=0.15),
        MathTex("B", color=B_COLOR).next_to(B, UP, buff=0.15),
        MathTex("C", color=C_COLOR).next_to(C, UP, buff=0.15),
    )
    return A, B, C, row, labels


def set_entry(ent, value, ref, color=WHITE):
    """Animation that turns a matrix entry into `value` (sized like the entry `ref`)."""
    new = MathTex(str(value)).match_height(ref).move_to(ent).set_color(color)
    return Transform(ent, new)


class Strip:
    """A matrix as a row-major memory strip, drawn as cells grouped into cache lines."""

    def __init__(self, name, mat, center, line, side=0.5):
        flat = [v for r in mat for v in r]
        self.cells = [Square(side_length=side, stroke_width=1.5, color=GREY_C) for _ in flat]
        groups = VGroup(
            *[VGroup(*self.cells[g * line:(g + 1) * line]).arrange(RIGHT, buff=0)
              for g in range(len(flat) // line)]
        )
        groups.arrange(RIGHT, buff=0.18).move_to(center)
        self.txts = [MathTex(str(v), font_size=22).move_to(c) for v, c in zip(flat, self.cells)]
        self.lines = [SurroundingRectangle(g, buff=0.03, color=GREY_A, stroke_width=3) for g in groups]
        label = Text(name, font_size=22).next_to(groups, LEFT, buff=0.3)
        self.group = VGroup(groups, *self.txts, *self.lines, label)

    def set(self, idx, value):
        return Transform(self.txts[idx], MathTex(str(value), font_size=22).move_to(self.cells[idx]))


class Cells:
    """A small grid of numbered cells (a register, a tile buffer)."""

    def __init__(self, rows, cols, center, side=0.55, color=GREY_C, font_size=24, init=r"\cdot"):
        self.font_size = font_size
        self.cells = [Square(side_length=side, stroke_width=2.5, color=color) for _ in range(rows * cols)]
        VGroup(*self.cells).arrange_in_grid(rows, cols, buff=0).move_to(center)
        inits = init if isinstance(init, list) else [init] * (rows * cols)
        self.txts = [self._text(v, c) for v, c in zip(inits, self.cells)]
        self.group = VGroup(*self.cells, *self.txts)

    def _text(self, value, cell):
        return MathTex(str(value), font_size=self.font_size).move_to(cell)

    def set(self, values):
        """Transforms that put `values` (flat, row-major) into the cells."""
        return [Transform(t, self._text(v, c)) for t, v, c in zip(self.txts, values, self.cells)]


class Narrator:
    """One short caption at a time; `say` returns the animation that swaps it."""

    def __init__(self, pos, width=6.2, font_size=20):
        self.pos, self.width, self.font_size, self.cur = pos, width, font_size, None

    def say(self, msg):
        new = Text(msg, font_size=self.font_size, line_spacing=0.9, color=GREY_A)
        if new.width > self.width:
            new.scale(self.width / new.width)
        new.move_to(self.pos)
        old, self.cur = self.cur, new
        return FadeIn(new) if old is None else FadeTransform(old, new)


class Code:
    """Monospace pseudocode with a moving highlight box. spec = [(indent, text), ...]."""

    def __init__(self, spec, anchor, font_size=18, max_width=6.2, step=0.3):
        self.lines = VGroup(*[Text(t, font="Monospace", font_size=font_size) for _, t in spec])
        self.lines.arrange(DOWN, aligned_edge=LEFT, buff=0.15)
        for (lvl, _), ln in zip(spec, self.lines):
            ln.shift(RIGHT * step * lvl)
        if self.lines.width > max_width:
            self.lines.scale(max_width / self.lines.width)
        self.lines.move_to(anchor, aligned_edge=UL)
        self.hl = None

    def _box(self, i):
        return SurroundingRectangle(self.lines[i], color=WHITE, buff=0.06)

    def goto(self, i):
        if self.hl is None:
            self.hl = self._box(i)
            return Create(self.hl)
        return Transform(self.hl, self._box(i))

    def hide(self):
        out = [FadeOut(self.lines)] + ([FadeOut(self.hl)] if self.hl is not None else [])
        self.hl = None
        return out
