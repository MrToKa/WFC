using AddinRibbon.Routing;

namespace PathFinder.Model;

/// <summary>Binary64, column-major affine matrices. Display rebasing is applied exactly once.</summary>
public static class AffineTransform
{
    public static double[] Identity => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    public static void Validate(double[] matrix)
    {
        if (matrix is null || matrix.Length != 16 || matrix.Any(v => !double.IsFinite(v)))
            throw new ArgumentException("An affine matrix needs 16 finite binary64 values.");
        if (matrix[3] != 0 || matrix[7] != 0 || matrix[11] != 0 || matrix[15] != 1)
            throw new ArgumentException("Perspective matrices are not model affine transforms.");
        var determinant = Determinant(matrix);
        if (!double.IsFinite(determinant) || determinant == 0) throw new ArgumentException("Affine matrix must be invertible.");
    }
    public static RoutePoint Apply(double[] matrix, RoutePoint point)
    {
        Validate(matrix);
        return new RoutePoint(matrix[0] * point.X + matrix[4] * point.Y + matrix[8] * point.Z + matrix[12],
            matrix[1] * point.X + matrix[5] * point.Y + matrix[9] * point.Z + matrix[13],
            matrix[2] * point.X + matrix[6] * point.Y + matrix[10] * point.Z + matrix[14]);
    }
    public static double[] Multiply(double[] left, double[] right)
    {
        Validate(left); Validate(right);
        var result = new double[16];
        for (var column = 0; column < 4; column++)
            for (var row = 0; row < 4; row++)
                for (var inner = 0; inner < 4; inner++) result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
        Validate(result);
        return result;
    }
    public static double[] Inverse(double[] matrix)
    {
        Validate(matrix);
        var a = matrix[0]; var b = matrix[4]; var c = matrix[8];
        var d = matrix[1]; var e = matrix[5]; var f = matrix[9];
        var g = matrix[2]; var h = matrix[6]; var i = matrix[10];
        var det = Determinant(matrix);
        double[] inverse = [(e * i - f * h) / det, (f * g - d * i) / det, (d * h - e * g) / det, 0,
            (c * h - b * i) / det, (a * i - c * g) / det, (b * g - a * h) / det, 0,
            (b * f - c * e) / det, (c * d - a * f) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
        inverse[12] = -(inverse[0] * matrix[12] + inverse[4] * matrix[13] + inverse[8] * matrix[14]);
        inverse[13] = -(inverse[1] * matrix[12] + inverse[5] * matrix[13] + inverse[9] * matrix[14]);
        inverse[14] = -(inverse[2] * matrix[12] + inverse[6] * matrix[13] + inverse[10] * matrix[14]);
        Validate(inverse);
        return inverse;
    }
    public static RoutePoint WorldToDisplay(RoutePoint worldMetres, RoutePoint globalOffsetMetres) =>
        new(worldMetres.X - globalOffsetMetres.X, worldMetres.Y - globalOffsetMetres.Y, worldMetres.Z - globalOffsetMetres.Z);
    public static RoutePoint DisplayToWorld(RoutePoint displayMetres, RoutePoint globalOffsetMetres) =>
        new(displayMetres.X + globalOffsetMetres.X, displayMetres.Y + globalOffsetMetres.Y, displayMetres.Z + globalOffsetMetres.Z);
    public static RoutePoint Point(double[] value)
    {
        if (value is null || value.Length != 3 || value.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1e12))
            throw new ArgumentException("A canonical point needs three finite coordinates within the declared 1e12m resource range.");
        return new RoutePoint(value[0], value[1], value[2]);
    }
    private static double Determinant(double[] m) => m[0] * (m[5] * m[10] - m[9] * m[6])
        - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}
