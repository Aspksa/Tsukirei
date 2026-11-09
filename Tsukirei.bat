@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "TSUKIREI_BAT=%~f0"
set "TSUKIREI_ARGS=%*"
where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Windows PowerShell 5.1 is required.
    pause
    exit /b 10
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:TSUKIREI_BAT,[Text.Encoding]::UTF8);$m='### TSUKIREI_PS_BEGIN ###';$i=$t.LastIndexOf($m);if($i -lt 0){exit 90};& ([ScriptBlock]::Create($t.Substring($i+$m.Length)))"
set "TSUKIREI_EXIT=%ERRORLEVEL%"
if not "%TSUKIREI_EXIT%"=="0" (
    echo.
    echo [Tsukirei] Launcher stopped with code %TSUKIREI_EXIT%.
    if /I not "%CI%"=="true" (
        echo Press any key to close this window.
        pause >nul
    )
)
exit /b %TSUKIREI_EXIT%
### TSUKIREI_PS_BEGIN ###
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $env:TSUKIREI_BAT
$runtime = Join-Path $root '.runtime'
$logs = Join-Path $root 'logs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$diagnose = ($env:TSUKIREI_ARGS -split '\s+') -contains '--diagnose'
$noOpen = ($env:TSUKIREI_ARGS -split '\s+') -contains '--no-open'
$help = ($env:TSUKIREI_ARGS -split '\s+') -contains '--help'

function Say([string]$message) { Write-Host "[Tsukirei] $message" }
function Find-App {
    foreach ($relative in @('.', 'frontend', 'web', 'app', 'client')) {
        $dir = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (Test-Path -LiteralPath (Join-Path $dir 'package.json') -PathType Leaf) { return $dir }
    }
    return $null
}
function Check-Node([string]$exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
    try {
        $version = (& $exe '--version' 2>$null).Trim()
        if ($version -notmatch '^v(\d+)\.(\d+)\.') { return $false }
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        return ($major -gt 22 -or ($major -eq 22 -and $minor -ge 18))
    } catch { return $false }
}
function Find-Node {
    $portable = Join-Path $runtime 'node'
    if (Test-Path -LiteralPath $portable -PathType Container) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $portable -Directory | Sort-Object Name -Descending)) {
            $exe = Join-Path $dir.FullName 'node.exe'
            if (Check-Node $exe) { return $exe }
        }
    }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Check-Node $cmd.Source)) { return $cmd.Source }
    return $null
}
function Find-NpmCli([string]$nodeExe) {
    $nodeDir = Split-Path -Parent $nodeExe
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add((Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'))
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand -and $npmCommand.Source) {
        $npmDir = Split-Path -Parent $npmCommand.Source
        $candidates.Add((Join-Path $npmDir 'node_modules\npm\bin\npm-cli.js'))
        $candidates.Add((Join-Path $npmDir '..\node_modules\npm\bin\npm-cli.js'))
    }
    if ($env:APPDATA) {
        $candidates.Add((Join-Path $env:APPDATA 'npm\node_modules\npm\bin\npm-cli.js'))
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }
    return $null
}
function Install-Node {
    Say 'Node.js 22.18+ не найден. Устанавливаю переносимый Node.js LTS без прав администратора...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    } else { 'x86' }
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
    $entry = $releases | Where-Object { $_.lts -ne $false -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
    if (-not $entry) { throw "Не найдена совместимая LTS-версия Node.js для Windows $arch." }
    $version = [string]$entry.version
    $name = "node-$version-win-$arch"
    $folder = Join-Path $runtime 'node'
    $destination = Join-Path $folder $name
    $existing = Join-Path $destination 'node.exe'
    if (Check-Node $existing) { return $existing }
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $temporary = Join-Path $folder ('.download-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary -Force | Out-Null
    try {
        $base = "https://nodejs.org/dist/$version"
        $zipName = "$name.zip"
        $zip = Join-Path $temporary $zipName
        $sums = Join-Path $temporary 'SHASUMS256.txt'
        Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zip -UseBasicParsing -TimeoutSec 120
        Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile $sums -UseBasicParsing -TimeoutSec 30
        $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ('\s+' + [regex]::Escape($zipName) + '$') } | Select-Object -First 1
        if (-not $line) { throw 'Не найдена контрольная сумма SHA-256 архива Node.js.' }
        $expected = ($line -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-Sha256 $zip).ToLowerInvariant()
        if ($expected -ne $actual) { throw 'Проверка SHA-256 не пройдена. Архив не используется.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $temporary -Force
        $expanded = Join-Path $temporary $name
        if (-not (Check-Node (Join-Path $expanded 'node.exe'))) { throw 'Архив Node.js повреждён или некорректен.' }
        if (-not (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $expanded -Destination $destination }
        return (Join-Path $destination 'node.exe')
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
function Get-Sha256([string]$path) {
    $hash = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($path)
    try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
}
function Ensure-PortablePostgres {
    $data = Join-Path $root 'data'
    $settings = Join-Path $data 'postgres-settings.json'
    $managed = Join-Path $data 'portable-postgres.json'
    if ($env:TSUKIREI_DATABASE_URL -or $env:DATABASE_URL) {
        Say 'Использую PostgreSQL из переменной окружения.'
        return
    }
    if ((Test-Path -LiteralPath $settings) -and -not (Test-Path -LiteralPath $managed)) {
        Say 'Использую PostgreSQL из существующих настроек.'
        return
    }
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        throw 'Автоустановка PostgreSQL доступна только на Windows x64.'
    }
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $exe = Join-Path $runtime 'pg0/pg0.exe'
    $expected = 'da580cc8fd390ba01158bea192d6bb6d4b0f583abc468ced7f9c582370c34cb6'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or (Get-Sha256 $exe).ToLowerInvariant() -ne $expected) {
        Say 'Загружаю переносимый PostgreSQL + pgvector...'
        New-Item -ItemType Directory -Path (Split-Path -Parent $exe) -Force | Out-Null
        $download = $exe + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $releaseUrl = 'https://github.com/vectorize-io/pg0/releases/download/v0.16.1/pg0-windows-x86_64.exe'
            $downloadComplete = $false
            for ($attempt = 1; $attempt -le 4; $attempt++) {
                try {
                    if (Test-Path -LiteralPath $download) {
                        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
                    }
                    Invoke-WebRequest -Uri $releaseUrl -OutFile $download -UseBasicParsing -TimeoutSec 240 -ErrorAction Stop
                    if ((Get-Sha256 $download).ToLowerInvariant() -ne $expected) { throw 'SHA-256 PostgreSQL не совпала.' }
                    $downloadComplete = $true
                    break
                } catch {
                    if ($_.Exception.Message -match 'SHA-256') { throw }
                    if ($attempt -eq 4) { throw }
                    Say ('Скачивание PostgreSQL не удалось (попытка ' + $attempt + '/4). Повторяю...')
                    Start-Sleep -Seconds ([Math]::Min(12, $attempt * 3))
                }
            }
            if (-not $downloadComplete) { throw 'Не удалось скачать проверенный PostgreSQL.' }
            Move-Item -LiteralPath $download -Destination $exe -Force
        } finally {
            if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue }
        }
    }

    if (Test-Path -LiteralPath $managed) {
        $config = Get-Content -LiteralPath $managed -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.version -ne 1 -or $config.password -notmatch '^[a-f0-9]{64}$' -or
            $config.port -lt 1024 -or $config.port -gt 65535 -or
            -not [IO.Path]::IsPathRooted([string]$config.store) -or
            [string]$config.store -cnotmatch '^[\x20-\x7E]+$') {
            throw 'Неверные настройки переносимой PostgreSQL. Не удаляйте данные!'
        }
        $store = [string]$config.store
        if (-not (Test-Path -LiteralPath $store -PathType Container)) {
            throw ('Не найден диск с базой данных: ' + $store + '. Новую базу автоматически не создаю.')
        }
    } else {
        $digest = [Security.Cryptography.SHA256]::Create()
        try {
            $id = ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '').Substring(0, 16)
        } finally { $digest.Dispose() }
        $store = $null
        $parent = $root
        while ($parent) {
            if ($parent -cmatch '^[\x20-\x7E]+$') {
                $candidate = Join-Path $parent ('Tsukirei-Postgres-' + $id)
                try {
                    New-Item -ItemType Directory -Path $candidate -Force -ErrorAction Stop | Out-Null
                    $attrs = (Get-Item -LiteralPath $candidate -Force).Attributes
                    if (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Нельзя использовать junction' }
                    $store = $candidate
                    break
                } catch { Say ('Не удалось использовать ' + $candidate) }
            }
            $up = Split-Path -Path $parent -Parent
            if (-not $up -or $up -eq $parent) { break }
            $parent = $up
        }
        if (-not $store) { throw 'Нужен доступный для записи латинский путь на диске с проектом.' }
        $port = $null
        foreach ($p in 55432..55480) {
            if (-not (Test-Port $p)) { $port = $p; break }
        }
        if (-not $port) { throw 'Порты PostgreSQL 55432–55480 заняты.' }
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $config = [pscustomobject]@{
            version = 1
            store = $store
            port = $port
            password = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
        }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($managed, ($config | ConvertTo-Json -Compress), $utf8)
    }
    $env:PG0_HOME = Join-Path $store 'pg0-home'
    $env:PG0_INSTALLATION_DIR = Join-Path $store 'pg0-installation'
    $env:TEMP = Join-Path $store 'temp'
    $env:TMP = $env:TEMP
    foreach ($folder in @($env:PG0_HOME, $env:PG0_INSTALLATION_DIR, $env:TEMP)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
    $db = Join-Path $store 'database'
    if (-not (Test-Path -LiteralPath (Join-Path $db 'PG_VERSION'))) {
        # initdb on Windows needs WRITE_DAC/Full Control for the current SID.
        # Grant it only to the current account, never Everyone and never system-wide.
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $access = '*' + $sid + ':(OI)(CI)F'
        & icacls.exe $store '/grant:r' $access '/T' '/C' | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'Не удалось установить права текущего пользователя на каталог PostgreSQL. Проверьте разрешения NTFS.'
        }
    }
    $script:PortablePG0 = $exe
    if (Test-Port ([int]$config.port)) {
        $info = (& $exe info --name tsukirei -o json 2>$null | Out-String)
        if ($LASTEXITCODE -ne 0 -or $info -notmatch '"running"\s*:\s*true') {
            throw 'Порт PostgreSQL занят другой программой. Не подключаюсь к неизвестной базе.'
        }
    } else {
        Say ('Инициализирую PostgreSQL + pgvector: ' + $store)
        # Do not pipe pg0 stdout into Out-String: postgres workers inherit pipe
        # handles and keep the PowerShell pipeline open indefinitely on Windows.
        $pgOut = Join-Path $logs ('pg0-' + $stamp + '-out.log')
        $pgErr = Join-Path $logs ('pg0-' + $stamp + '-err.log')
        $argsPg = 'start --name tsukirei --port ' + [string]$config.port +
            ' --data-dir "' + $db + '" --username tsukirei --password ' + [string]$config.password +
            ' --database tsukirei --config listen_addresses=127.0.0.1 --config shared_buffers=64MB --config work_mem=8MB'
        $pgProcess = Start-Process -FilePath $exe -ArgumentList $argsPg -NoNewWindow -PassThru -RedirectStandardOutput $pgOut -RedirectStandardError $pgErr
        try {
            if (-not $pgProcess.WaitForExit(120000)) {
                try { $pgProcess.Kill() } catch { }
                throw 'Программа запуска PostgreSQL не завершилась за 120 секунд. Проверьте logs/pg0-*-err.log.'
            }
            # pg0 may emit a non-zero status after creating an operational
            # PostgreSQL instance. Confirm the instance itself before deciding.
            $pgStatusText = (& $exe info --name tsukirei -o json 2>$null | Out-String)
            $pgInfoOk = ($LASTEXITCODE -eq 0 -and $pgStatusText -match '"running"\s*:\s*true')
            if (-not $pgInfoOk -or -not (Test-Port ([int]$config.port))) {
                $pgText = ((Get-ExitText $pgErr) + (Get-ExitText $pgOut)).Replace([string]$config.password, '[скрыто]')
                throw ('PostgreSQL не запустился: ' + $pgText)
            }
            if ($pgProcess.ExitCode -ne 0) {
                Say 'pg0 вывел предупреждения, но PostgreSQL проверен и работает.'
            }
        } finally {
            $pgProcess.Dispose()
            # pg0 prints a connection URI containing the generated password.
            # Keep it only in the ignored settings file, not in the logs.
            Remove-Item -LiteralPath $pgOut, $pgErr -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not (Test-Port ([int]$config.port))) { throw 'Сервер PostgreSQL не отвечает.' }
    $script:PortablePG0Started = $true
    $url = 'postgresql://tsukirei:' + $config.password + '@127.0.0.1:' + $config.port + '/tsukirei'
    $env:TSUKIREI_DATABASE_URL = $url
    if (-not (Test-Path -LiteralPath $settings)) {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($settings, (@{ url = $url } | ConvertTo-Json -Compress), $utf8)
    }
    Say ('PostgreSQL готов. Папка данных на том же диске: ' + $store)
}
function Test-Port([int]$number) {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $async = $tcp.BeginConnect('127.0.0.1', $number, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(350)) { return $false }
        $tcp.EndConnect($async)
        return $true
    } catch { return $false }
    finally { $tcp.Close() }
}
function Get-ExitText([string]$path) {
    if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Tail 35 -ErrorAction SilentlyContinue | Out-String) }
    return ''
}

if ($help) {
    Say 'Команды: Tsukirei.bat [--diagnose] [--no-open] [--help]'
    Say '--diagnose проверяет окружение без установки и запуска приложения.'
    exit 0
}
Say "Папка проекта: $root"
$app = Find-App
if ($diagnose) {
    Say "Windows PowerShell: $($PSVersionTable.PSVersion)"
    Say "Приложение: $(if ($app) { $app } else { 'пока отсутствует (есть только BAT и README)' })"
    $node = Find-Node
    Say "Node.js 22.18+: $(if ($node) { $node } else { 'не найден; при запуске установится автоматически' })"
    Say "npm CLI: $(if ($node) { $cli = Find-NpmCli $node; if ($cli) { $cli } else { 'не найден' } } else { 'проверка после установки Node.js' })"
    Say "Локальные файлы: $runtime; журналы: $logs"
    Say "PostgreSQL: $(if (Test-Path -LiteralPath (Join-Path $root 'data/portable-postgres.json')) { 'переносимый настроен' } elseif (Test-Path -LiteralPath (Join-Path $root 'data/postgres-settings.json')) { 'внешний сервер' } else { 'автоустановка при запуске' })"
    Say 'Диагностика завершена.'
    exit 0
}
if (-not $app) {
    Say 'Исходники приложения не найдены. Репозиторий пока пустой — это ожидаемо.'
    Say 'BAT готов. Для запуска сайта нужно добавить исходники и package.json.'
    Say 'Для проверки запустите Tsukirei.bat --diagnose.'
    exit 2
}

$mutex = $null
$process = $null
$script:PortablePG0 = $null
$script:PortablePG0Started = $false
try {
    New-Item -ItemType Directory -Path $runtime, $logs -Force | Out-Null
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())) }
    finally { $sha.Dispose() }
    $name = 'Local\Tsukirei_' + ([BitConverter]::ToString($bytes).Replace('-', '').Substring(0, 24))
    $mutex = [System.Threading.Mutex]::new($false, $name)
    if (-not $mutex.WaitOne(0, $false)) { Say 'Этот экземпляр Tsukirei уже запущен.'; exit 3 }

    $node = Find-Node
    if (-not $node) { $node = Install-Node }
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    $npmCli = Find-NpmCli $node
    if (-not $npmCli) {
        throw 'npm CLI не найден. Проверьте установку Node.js и npm.cmd либо удалите повреждённую папку .runtime/node для повторной загрузки.'
    }
    Say ('Node.js: ' + $node)
    Say ('npm CLI: ' + $npmCli)
    $packageFile = Join-Path $app 'package.json'
    $package = Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script = @('dev', 'start', 'preview') | Where-Object { $package.scripts -and $package.scripts.PSObject.Properties.Name -contains $_ } | Select-Object -First 1
    if (-not $script) { throw 'В package.json нет команды dev, start или preview.' }
    $scriptContent = [string]$package.scripts.$script
    $vite = $scriptContent -match '(?i)(^|\s|/|\\)vite(\s|$)'
    $next = $scriptContent -match '(?i)next\s+dev'
    $defaultPort = if ($vite) { 5173 } else { 3000 }
    $port = $defaultPort
    if ($env:TSUKIREI_PORT) {
        $candidate = 0
        if (-not [int]::TryParse($env:TSUKIREI_PORT, [ref]$candidate) -or $candidate -lt 1024 -or $candidate -gt 65535) {
            throw 'TSUKIREI_PORT должен быть числом от 1024 до 65535.'
        }
        $port = $candidate
    }
    if (-not $env:TSUKIREI_PORT -and (Test-Port $port)) {
        $originalPort = $port
        foreach ($candidate in 3001..3020) {
            if (-not (Test-Port $candidate)) { $port = $candidate; break }
        }
        if ($port -eq $originalPort) { throw 'Все порты 3000–3020 заняты. Укажите свободный TSUKIREI_PORT.' }
        Say "Порт $originalPort занят. Использую свободный порт $port."
    }
    if (Test-Port $port) { throw "Порт $port занят. Закройте другой сервер или укажите свободный TSUKIREI_PORT." }
    $env:PORT = "$port"
    $env:HOST = '127.0.0.1'
    $env:npm_config_cache = Join-Path $runtime 'npm-cache'
    $env:npm_config_update_notifier = 'false'

    $lock = Join-Path $app 'package-lock.json'
    $deps = Join-Path $app 'node_modules'
    $installMarker = Join-Path $runtime ('deps-' + [IO.Path]::GetFileName($app) + '.sha256')
    $depHash = (Get-Sha256 $(if (Test-Path -LiteralPath $lock) { $lock } else { $packageFile }))
    $hasPackages = ($package.dependencies -and $package.dependencies.PSObject.Properties.Count -gt 0) -or ($package.devDependencies -and $package.devDependencies.PSObject.Properties.Count -gt 0)
    $installed = ((-not $hasPackages) -or (Test-Path -LiteralPath $deps -PathType Container)) -and (Test-Path -LiteralPath $installMarker -PathType Leaf) -and ((Get-Content -LiteralPath $installMarker -Raw).Trim() -eq $depHash)
    if (-not $installed) {
        Say 'Устанавливаю или обновляю зависимости приложения...'
        Push-Location -LiteralPath $app
        try {
            if (Test-Path -LiteralPath $lock) { & $node $npmCli ci --no-audit --no-fund }
            else { & $node $npmCli install --no-audit --no-fund }
            if ($LASTEXITCODE -ne 0) { throw "Установка npm завершилась с ошибкой (код $LASTEXITCODE)." }
        } finally { Pop-Location }
        $depHash = (Get-Sha256 $(if (Test-Path -LiteralPath $lock) { $lock } else { $packageFile }))
        Set-Content -LiteralPath $installMarker -Value $depHash -Encoding Ascii
    }

    Ensure-PortablePostgres

    $output = Join-Path $logs "$stamp-out.log"
    $errors = Join-Path $logs "$stamp-error.log"
    $args = '"' + $npmCli + '" run ' + $script
    if ($vite) { $args += " -- --host 127.0.0.1 --port $port --strictPort" }
    elseif ($next) { $args += " -- --hostname 127.0.0.1 --port $port" }
    Say "Запускаю npm run $script, порт $port..."
    Say "Журналы: $output и $errors"
    $process = Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $app -RedirectStandardOutput $output -RedirectStandardError $errors -NoNewWindow -PassThru
    $url = "http://127.0.0.1:$port/"
    $ready = $false
    for ($seconds = 0; $seconds -lt 60; $seconds++) {
        $process.Refresh()
        if ($process.HasExited) { break }
        if (Test-Port $port) {
            try {
                $response = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
                if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400) {
                    $health = Invoke-RestMethod -Uri ($url + 'api/health') -TimeoutSec 3
                    if ($health.ok -eq $true -and $health.name -eq 'Tsukirei') {
                        $ready = $true
                        break
                    }
                }
            } catch { }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        Say 'Сервер не открылся. Последние строки журналов:'
        Write-Host (Get-ExitText $errors)
        Write-Host (Get-ExitText $output)
        throw 'Приложение не запустилось. Посмотрите ошибки выше.'
    }
    Say "Сервер готов: $url"
    if (-not $noOpen) {
        try { Start-Process $url | Out-Null }
        catch { Say "Браузер не открылся автоматически. Откройте вручную: $url" }
    }
    Say 'Для остановки нажмите Ctrl+C в этом окне.'
    while (-not $process.HasExited) { Start-Sleep -Seconds 1; $process.Refresh() }
    Say "Сервер остановлен (код $($process.ExitCode))."
    if ($process.ExitCode -ne 0) { Write-Host (Get-ExitText $errors); exit $process.ExitCode }
} catch {
    Say "ОШИБКА: $($_.Exception.Message)"
    try {
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        Add-Content -LiteralPath (Join-Path $logs 'launcher-errors.log') -Value "[$(Get-Date -Format o)] $($_ | Out-String)" -Encoding UTF8
    } catch { }
    exit 1
} finally {
    if ($process) {
        try { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } } catch { }
        $process.Dispose()
    }
    if ($script:PortablePG0Started -and $script:PortablePG0) {
        try { & $script:PortablePG0 stop --name tsukirei 2>$null | Out-Null } catch { }
    }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch { }
        $mutex.Dispose()
    }
}
exit 0
