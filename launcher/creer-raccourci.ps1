# Crée le raccourci « Prospecto » sur le bureau Windows (appelé par Installer-Windows.bat).
param([switch]$Demarrage)
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$target = if ($Demarrage) { [Environment]::GetFolderPath('Startup') } else { [Environment]::GetFolderPath('Desktop') }
$s = $shell.CreateShortcut((Join-Path $target 'Prospecto.lnk'))
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + (Join-Path $root 'launcher\Prospecto.vbs') + '"' + $(if ($Demarrage) { ' --silencieux' } else { '' })
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root 'launcher\prospecto.ico')
$s.Description = 'Prospecto - candidatures spontanees'
$s.Save()
Write-Host "Raccourci cree : $($s.FullName)"
