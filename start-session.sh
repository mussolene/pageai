#!/bin/bash
# Optional dev helper: interactive session setup and LM Studio check.
# Not required for build/test. Main commands: npm install && npm run dev (or build).
# 🚀 Confluence AI Extension - Development Session Starter

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функции
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

check_lm_studio() {
    print_header "Проверка LM Studio"
    
    if curl -s http://localhost:1234/v1/models > /dev/null 2>&1; then
        print_success "LM Studio доступна на localhost:1234"
        
        # Проверить модель
        MODEL=$(curl -s http://localhost:1234/v1/models | grep -o 'qwen[^"]*' | head -1)
        if [ -n "$MODEL" ]; then
            print_success "Модель: $MODEL"
        else
            print_warning "Не найдена модель qwen, но сервис доступен"
        fi
    else
        print_error "LM Studio НЕ доступна на localhost:1234"
        echo -e "\n${YELLOW}Установка и запуск LM Studio:${NC}"
        echo "1. Скачать с https://lmstudio.ai/"
        echo "2. Запустить LM Studio"
        echo "3. Загрузить модель qwen/qwen3-4b-2507"
        echo "4. Нажать 'Start Server' на localhost:1234"
        echo ""
        print_warning "Продолжить без LM Studio? (разработка возможна, но без LLM тестов)"
    fi
}

show_sessions() {
    print_header "Доступные сессии разработки"
    
    echo "Select session (или 0 для меню):"
    echo ""
    echo "🔄 IN PROGRESS:"
    echo "  1) Session #1: Интеграция с LM Studio"
    echo ""
    echo "⏳ QUEUED:"
    echo "  2) Session #2: Markdown рендеринг"
    echo "  3) Session #3: Ссылки на источники"
    echo "  4) Session #4: Кеширование результатов"
    echo "  5) Session #5: Перечисление Confluence spaces"
    echo ""
    echo "  0) Выход"
    echo ""
}

setup_session_1() {
    print_header "Session #1: Интеграция с LM Studio"
    
    echo "Модули для разработки:"
    echo "  📝 src/llm/client.ts (CREATE)"
    echo "  📝 src/llm/prompts.ts (UPDATE)"
    echo "  📝 src/ui/panel.ts (UPDATE)"
    echo ""
    
    echo "Mock данные:"
    echo "  📋 tests/mocks/llm-responses.json"
    echo ""
    
    echo "Требования:"
    echo "  ✓ Клиент LLM подключается к localhost:1234"
    echo "  ✓ Поддержка модели qwen/qwen3-4b-2507"
    echo "  ✓ Обработка ошибок с graceful fallback"
    echo "  ✓ Кеширование ответов в IndexedDB"
    echo "  ✓ Поддержка streaming и non-streaming"
    echo ""
    
    echo "Разработка:"
    echo "  npm run dev"
    echo ""
    echo "Тестирование:"
    echo "  curl http://localhost:1234/v1/models"
    echo "  npm test"
    echo ""
    echo "Загрузка в Chrome:"
    echo "  chrome://extensions/ → Load unpacked → dist/"
    echo ""
}

setup_session_2() {
    print_header "Session #2: Markdown рендеринг"
    
    echo "Модули для разработки:"
    echo "  📝 src/ui/panel.ts (UPDATE)"
    echo "  📝 src/ui/panel.css (UPDATE)"
    echo ""
    
    echo "Требования:"
    echo "  ✓ Поддержка bold, italic, code"
    echo "  ✓ Заголовки h1-h3"
    echo "  ✓ Списки и вложенные списки"
    echo "  ✓ Code blocks с подсветкой"
    echo "  ✓ Таблицы"
    echo "  ✓ Ссылки"
    echo ""
    
    echo "Зависит от: Session #1 (нужен работающий LLM клиент)"
    echo ""
}

setup_session_3() {
    print_header "Session #3: Ссылки на источники"
    
    echo "Модули для разработки:"
    echo "  📝 src/llm/prompts.ts (UPDATE)"
    echo "  📝 src/ui/panel.ts (UPDATE)"
    echo "  📝 src/search/ (UPDATE)"
    echo ""
    
    echo "Требования:"
    echo "  ✓ Chat добавляет источники в конце ответа"
    echo "  ✓ Ссылки открываются в Confluence"
    echo "  ✓ Отображение иконки источника"
    echo "  ✓ Пронумерованный список источников"
    echo ""
    
    echo "Зависит от: Session #2 (нужен markdown рендеринг)"
    echo ""
}

setup_session_4() {
    print_header "Session #4: Кеширование результатов"
    
    echo "Модули для разработки:"
    echo "  📝 src/storage/indexdb.ts (UPDATE)"
    echo "  📝 src/api/confluence.ts (UPDATE)"
    echo ""
    
    echo "Требования:"
    echo "  ✓ Кеш результатов в IndexedDB с TTL"
    echo "  ✓ Graceful fallback при offline"
    echo "  ✓ Очищение кеша по команде"
    echo "  ✓ Админ интерфейс управления кешем"
    echo ""
    
    echo "TTL по умолчанию: 24 часа"
    echo ""
}

setup_session_5() {
    print_header "Session #5: Перечисление Confluence spaces"
    
    echo "Модули для разработки:"
    echo "  📝 src/api/confluence.ts (UPDATE)"
    echo "  📝 src/ui/panel.ts (UPDATE)"
    echo ""
    
    echo "Требования:"
    echo "  ✓ API call получает список spaces"
    echo "  ✓ UI dropdown со spaces"
    echo "  ✓ Сохранение выбора в localStorage"
    echo "  ✓ Фильтрация поиска по space"
    echo "  ✓ Default: 'All spaces'"
    echo ""
    
    echo "Mock данные:"
    echo "  📋 tests/mocks/confluence-spaces.json"
    echo ""
}

install_deps() {
    print_header "Установка зависимостей"
    
    if [ ! -d "node_modules" ]; then
        print_warning "node_modules не найдены"
        echo "Запуск: npm install"
        npm install
    else
        print_success "node_modules уже установлены"
    fi
}

start_dev_server() {
    print_header "Запуск dev-сборки"
    
    echo "Команда: npm run dev"
    echo ""
    echo "Watch-сборка в dist/ (esbuild). Загрузите расширение: chrome://extensions → Load unpacked → dist/"
    echo ""
    
    read -p "Запустить dev сервер? (y/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        npm run dev
    fi
}

main() {
    clear
    
    print_header "🚀 Confluence AI Extension - Development Session Manager"
    
    # Проверить LM Studio один раз
    check_lm_studio
    
    # Меню выбора сессии
    while true; do
        show_sessions
        read -p "Выбрать сессию: " choice
        
        case $choice in
            1)
                install_deps
                setup_session_1
                start_dev_server
                break
                ;;
            2)
                install_deps
                setup_session_2
                start_dev_server
                break
                ;;
            3)
                install_deps
                setup_session_3
                start_dev_server
                break
                ;;
            4)
                install_deps
                setup_session_4
                start_dev_server
                break
                ;;
            5)
                install_deps
                setup_session_5
                start_dev_server
                break
                ;;
            0)
                print_success "До встречи! 👋"
                exit 0
                ;;
            *)
                print_error "Неверный выбор. Попробуйте снова."
                ;;
        esac
    done
}

main
