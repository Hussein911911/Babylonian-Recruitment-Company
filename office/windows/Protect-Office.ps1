param([Parameter(Mandatory=$true)][string]$PrivateDirectory)
$ErrorActionPreference = 'Stop'
$path = (Resolve-Path $PrivateDirectory).Path
# Dedicated directory only: never run against Windows, a user home or repository.
if ((Split-Path $path -Leaf) -notin @('.office','HRC-Private','HRC-Recovery')) { throw 'Use a dedicated .office, HRC-Private or HRC-Recovery directory.' }
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$propagate = [System.Security.AccessControl.PropagationFlags]::None
foreach ($principal in @($sid,$system)) {
 $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,$propagate,[System.Security.AccessControl.AccessControlType]::Allow)
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $path -AclObject $acl
# Reset child DACLs to inherit this restricted parent, removing old explicit grants.
if (Get-ChildItem -LiteralPath $path -Force | Select-Object -First 1) {
 & icacls.exe (Join-Path $path '*') /reset /T /C
 if ($LASTEXITCODE -ne 0) { throw 'Child ACL reset failed; do not start.' }
}
Write-Host 'Dedicated directory restricted to the current Windows account and SYSTEM. Enable BitLocker/device encryption separately.'
