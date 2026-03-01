param([string]$Hwnd)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WindowHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);
}
"@

$HWND_BOTTOM = [IntPtr]::new(1)
$SWP_NOSIZE     = 0x0001
$SWP_NOMOVE     = 0x0002
$SWP_NOACTIVATE = 0x0010
$flags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE

$handle = [IntPtr]::new([int64]$Hwnd)
[WindowHelper]::SetWindowPos($handle, $HWND_BOTTOM, 0, 0, 0, 0, $flags) | Out-Null
