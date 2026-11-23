[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'WFC-AI\Secrets'
[void][IO.Directory]::CreateDirectory($directory)
if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The local secrets folder must be a regular directory.'
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
$info = [IO.DirectoryInfo]::new($directory)
if ($PSVersionTable.PSEdition -eq 'Core') {
    [IO.FileSystemAclExtensions]::SetAccessControl($info, $acl)
} else {
    $info.SetAccessControl($acl)
}
$path = Join-Path $directory 'openai-api-key'
$temp = Join-Path $directory ([Guid]::NewGuid().ToString('N'))
$secret = Read-Host 'OpenAI project API key (hidden)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($value -notmatch '^sk-[!-~]{10,4000}$') { throw 'Invalid OpenAI key format.' }
    [IO.File]::WriteAllText($temp, $value, (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($path)) { [IO.File]::Replace($temp, $path, [Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temp, $path) }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $value = $null
    $secret.Dispose()
    if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
}
Write-Output 'OpenAI key saved for the local WFC document-analysis job.'

