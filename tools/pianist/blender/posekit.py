"""Small, deterministic posing toolkit for the MPFB 'default' rig (armature at identity transform).

All helpers work in armature space (== world space here) by writing PoseBone.matrix,
so they are independent of the per-bone roll conventions of the rig.
"""
import bpy, math
from mathutils import Vector, Matrix, Quaternion


def upd():
    bpy.context.view_layer.update()


def P(arm, name):
    return arm.pose.bones[name]


def head(arm, name):
    upd()
    return P(arm, name).head.copy()


def tail(arm, name):
    upd()
    return P(arm, name).tail.copy()


def rotate_about(arm, name, R3, pivot=None):
    """Rotate pose bone `name` (and so its children) by world rotation R3 (3x3) about pivot (default: bone head)."""
    upd()
    pb = P(arm, name)
    M = pb.matrix.copy()
    if pivot is None:
        pivot = M.translation.copy()
    T = Matrix.Translation(pivot) @ R3.to_4x4() @ Matrix.Translation(-pivot)
    pb.matrix = T @ M
    upd()


def translate(arm, name, d):
    upd()
    pb = P(arm, name)
    pb.matrix = Matrix.Translation(Vector(d)) @ pb.matrix
    upd()


def aim_chain(arm, first, last, target):
    """Rotate bone `first` about its head so that the tail of `last` (a descendant) points at `target`."""
    h = head(arm, first)
    t = tail(arm, last)
    q = (t - h).rotation_difference(Vector(target) - h)
    rotate_about(arm, first, q.to_matrix())


def twist(arm, name, angle, axis_from=None, axis_to=None):
    """Rotate bone about its own long axis (or about axis_from->axis_to) by angle (rad)."""
    upd()
    pb = P(arm, name)
    if axis_from is None:
        ax = (pb.tail - pb.head).normalized()
    else:
        ax = (Vector(axis_to) - Vector(axis_from)).normalized()
    rotate_about(arm, name, Matrix.Rotation(angle, 3, ax))


def hand_frame(arm, side):
    """Return (forward, lateral(thumb->pinky), palm_normal) of a hand in current pose.
    palm_normal points OUT of the palm (the side the fingers curl toward)."""
    s = side
    w = head(arm, f'wrist.{s}')
    mid = head(arm, f'finger3-1.{s}')
    idx = head(arm, f'finger2-1.{s}')
    pky = head(arm, f'finger5-1.{s}')
    fwd = (mid - w).normalized()
    lat = (pky - idx)
    lat = (lat - fwd * lat.dot(fwd)).normalized()
    n = fwd.cross(lat).normalized()
    # disambiguate: the thumb tip lies on the palm side of the metacarpal plane
    th = tail(arm, f'finger1-3.{s}')
    if (th - w).dot(n) < 0:
        n = -n
    return fwd, lat, n


def basis(fwd, n):
    f = fwd.normalized()
    n = (n - f * n.dot(f)).normalized()
    l = n.cross(f)
    return Matrix((f, l, n)).transposed()  # columns f,l,n


def orient_hand(arm, side, fwd_t, n_t, twist_bones=('lowerarm01', 'lowerarm02'), twist_share=(0.5, 0.5)):
    """Orient hand so its forward axis -> fwd_t and palm normal -> n_t.
    The twist component about the forearm axis is distributed over the forearm twist bones first
    (pronation/supination happens in the forearm, not the wrist), the rest is applied at the wrist."""
    s = side
    f, l, n = hand_frame(arm, s)
    R = basis(Vector(fwd_t), Vector(n_t)) @ basis(f, n).transposed()
    q = R.to_quaternion()
    fa = (head(arm, f'wrist.{s}') - head(arm, f'{twist_bones[0]}.{s}')).normalized()
    # swing-twist decomposition about the forearm axis
    proj = fa * Vector(q[1:]).dot(fa)
    qt = Quaternion((q.w, proj.x, proj.y, proj.z))
    if qt.magnitude > 1e-8:
        qt.normalize()
        ang = qt.angle if Vector(qt[1:]).dot(fa) >= 0 else -qt.angle
        if ang > math.pi:
            ang -= 2 * math.pi
        for b, sh in zip(twist_bones, twist_share):
            twist(arm, f'{b}.{s}', ang * sh, head(arm, f'{twist_bones[0]}.{s}'), head(arm, f'wrist.{s}'))
    f, l, n = hand_frame(arm, s)
    R = basis(Vector(fwd_t), Vector(n_t)) @ basis(f, n).transposed()
    rotate_about(arm, f'wrist.{s}', R)


def flex(arm, name, angle, palm_n, abduct=0.0, lat=None, axis=None):
    """Flex a finger bone toward the palm by `angle` (rad); optional abduction about palm normal.
    `axis` (recommended): the hand's flexion axis fwd x palm_n. Without it the axis is d x palm_n, which flips sign
    once a segment has already rotated past the palm normal (cumulative flexion > ~90 deg) -> hyperextended DIP."""
    upd()
    pb = P(arm, name)
    d = (pb.tail - pb.head).normalized()
    if axis is not None:
        ax = Vector(axis); ax = (ax - d * ax.dot(d)).normalized()
    else:
        ax = d.cross(palm_n).normalized()
    R = Matrix.Rotation(angle, 3, ax)
    if abduct:
        R = Matrix.Rotation(abduct, 3, palm_n) @ R
    rotate_about(arm, name, R)


def two_bone_elbow(S, W, a, b, pole):
    """Analytic 2-bone IK: elbow position for shoulder S, wrist W, lengths a,b and pole direction."""
    S, W, pole = Vector(S), Vector(W), Vector(pole)
    d = W - S
    L = min(d.length, a + b - 1e-4)
    u = d.normalized()
    x = (a * a - b * b + L * L) / (2 * L)
    h = math.sqrt(max(a * a - x * x, 0.0))
    p = (pole - u * pole.dot(u)).normalized()
    return S + u * x + p * h
