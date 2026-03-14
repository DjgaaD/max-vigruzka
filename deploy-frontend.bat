@echo off
rem При двойном щелчке запускаем себя в новом окне с cmd /k — окно не закроется после выполнения
if "%~1"=="" (
    start "Deploy MAX Vigruzka" cmd /k "%~f0" run
    exit /b 0
)
if /i not "%~1"=="run" (
    start "Deploy MAX Vigruzka" cmd /k "%~f0" run %*
    exit /b 0
)

chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   MAX VIGRUZKA - DEPLOY (LOCAL + SERVER)
echo ============================================
echo.

rem --- Сообщение коммита (при запуске с "run" первый аргумент отбрасываем) ---
shift
set "COMMIT_MSG=%*"
if "%COMMIT_MSG%"=="" (
    set /P COMMIT_MSG=Введите сообщение коммита: 
)

echo.
echo [1/6] Статус репозитория...
git status
if errorlevel 1 (
    echo ОШИБКА: git status
    pause
    exit /b 1
)

echo.
echo [2/6] Добавляю изменения...
git add -A
if errorlevel 1 (
    echo ОШИБКА: git add
    pause
    exit /b 1
)

echo.
echo [3/6] Коммит: "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo INFO: Коммит не создан (нет изменений или ошибка)
)

echo.
echo [4/6] Отправляю в репозиторий...
git push
if errorlevel 1 (
    echo ОШИБКА: git push
    pause
    exit /b 1
)

echo.
echo [5/6] Локальная сборка фронтенда...
cd frontend
npm install
if errorlevel 1 (
    echo ОШИБКА: npm install
    cd ..
    pause
    exit /b 1
)
npm run build
if errorlevel 1 (
    echo ОШИБКА: npm run build
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo [6/6] Обновление на сервере и выкладка фронта...
echo Внимание: git reset --hard на сервере сотрёт локальные правки на VPS.
echo.

ssh root@178.255.127.75 "cd /opt/max-vigruzka && git fetch origin && git reset --hard origin/master && cd frontend && chmod +x node_modules/.bin/vite 2>/dev/null; npm install && npm run build && mkdir -p /var/www/max-vigruzka && rm -rf /var/www/max-vigruzka/* && cp -r dist/* /var/www/max-vigruzka/ && systemctl reload nginx"
if errorlevel 1 (
    echo.
    echo ВНИМАНИЕ: Команды на сервере завершились с ошибкой.
    echo Проверьте SSH и логи на VPS.
    goto :finish
)
echo.
echo ============================================
echo   ДЕПЛО ЗАВЕРШЁН
echo   Проверьте https://mintday.ru/ и приложение в MAX
echo ============================================

:finish
echo.
echo Нажмите любую клавишу, чтобы закрыть окно...
pause
