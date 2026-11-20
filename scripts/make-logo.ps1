Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LogoKey
{
    static void BlurAlpha(byte[] buf, int stride, int w, int h, int radius)
    {
        byte[] src = (byte[])buf.Clone();
        for (int y = 0; y < h; y++)
        {
            int row = y * stride;
            for (int x = 0; x < w; x++)
            {
                int sum = 0, count = 0;
                for (int k = -radius; k <= radius; k++)
                {
                    int xx = x + k;
                    if (xx < 0 || xx >= w) continue;
                    sum += src[row + xx * 4 + 3];
                    count++;
                }
                buf[row + x * 4 + 3] = (byte)(sum / count);
            }
        }
        src = (byte[])buf.Clone();
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int sum = 0, count = 0;
                for (int k = -radius; k <= radius; k++)
                {
                    int yy = y + k;
                    if (yy < 0 || yy >= h) continue;
                    sum += src[yy * stride + x * 4 + 3];
                    count++;
                }
                buf[y * stride + x * 4 + 3] = (byte)(sum / count);
            }
        }
    }

    public static string Run(string input, string output)
    {
        using (var bmp = new Bitmap(input))
        {
            int w = bmp.Width, h = bmp.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            int len = Math.Abs(stride) * h;
            byte[] buf = new byte[len];
            Marshal.Copy(data.Scan0, buf, 0, len);

            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                for (int x = 0; x < w; x++)
                {
                    int i = row + x * 4;
                    double a = buf[i + 3];
                    double na = (a - 55.0) * 255.0 / (240.0 - 55.0);
                    if (na < 0) na = 0;
                    if (na > 255) na = 255;
                    na = Math.Pow(na / 255.0, 1.25) * 255.0;
                    buf[i + 3] = (byte)Math.Round(na);
                }
            }

            // Smooth the residual alpha noise into a soft glow, then drop the dust.
            BlurAlpha(buf, stride, w, h, 4);
            BlurAlpha(buf, stride, w, h, 4);
            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                for (int x = 0; x < w; x++)
                {
                    int i = row + x * 4 + 3;
                    if (buf[i] < 8) buf[i] = 0;
                }
            }
            Marshal.Copy(buf, 0, data.Scan0, len);
            bmp.UnlockBits(data);

            int minX = w, minY = h, maxX = -1, maxY = -1;
            for (int y = 0; y < h; y++)
            {
                int row = y * stride;
                for (int x = 0; x < w; x++)
                {
                    if (buf[row + x * 4 + 3] > 10)
                    {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < minX) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }

            int padX = Math.Max(8, (int)Math.Round((maxX - minX + 1) * 0.025));
            int padY = Math.Max(8, (int)Math.Round((maxY - minY + 1) * 0.025));
            int cx = Math.Max(0, minX - padX);
            int cy = Math.Max(0, minY - padY);
            int cw = Math.Min(w - cx, (maxX - minX + 1) + padX * 2);
            int ch = Math.Min(h - cy, (maxY - minY + 1) + padY * 2);

            using (var outBmp = new Bitmap(cw, ch, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(outBmp))
                {
                    g.Clear(Color.Transparent);
                    g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                    g.DrawImage(bmp, new Rectangle(0, 0, cw, ch), new Rectangle(cx, cy, cw, ch), GraphicsUnit.Pixel);
                }
                outBmp.Save(output, ImageFormat.Png);
            }
            return string.Format("{0}x{1} crop {2},{3} {4}x{5}", w, h, cx, cy, cw, ch);
        }
    }
}
"@ -ReferencedAssemblies System.Drawing

$out = [LogoKey]::Run((Resolve-Path "public\brand\logo-hx-original.png").Path, (Join-Path (Get-Location) "public\brand\logo-hx.png"))
"result: $out"
