// ==UserScript==
// @name         快捷链接区域打开工具（可拖动配置版）
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  配置按钮可拖动，支持快捷键选区打开链接，过滤页码，按坐标排序
// @author       You
// @match        *://*/*
// @grant        GM_openInTab
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // 加载按钮位置
    const loadButtonPosition = () => {
        try {
            return GM_getValue('buttonPosition') || { right: 20, bottom: 20 };
        } catch {
            return { right: 20, bottom: 20 };
        }
    };

    const saveButtonPosition = (pos) => GM_setValue('buttonPosition', pos);

    // 创建配置按钮
    const configButton = document.createElement('button');
    configButton.innerHTML = '⚙️';
    configButton.id = 'link-opener-config-btn';

    // 应用保存的位置或默认位置
    const buttonPos = loadButtonPosition();
    Object.assign(configButton.style, {
        position: 'fixed',
        right: `${buttonPos.right}px`,
        bottom: `${buttonPos.bottom}px`,
        zIndex: 9999,
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: '#ff4444',
        color: 'white',
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
        userSelect: 'none'
    });

    document.body.appendChild(configButton);

    // 添加拖动功能
    let isDraggingButton = false;
    let dragStartX, dragStartY;
    let initialRight, initialBottom;

    configButton.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        isDraggingButton = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = configButton.getBoundingClientRect();
        initialRight = window.innerWidth - rect.right;
        initialBottom = window.innerHeight - rect.bottom;

        configButton.style.opacity = '0.7';
        configButton.style.cursor = 'grabbing';

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingButton) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        const newRight = Math.max(0, Math.min(window.innerWidth - 40, initialRight - deltaX));
        const newBottom = Math.max(0, Math.min(window.innerHeight - 40, initialBottom - deltaY));

        configButton.style.right = `${newRight}px`;
        configButton.style.bottom = `${newBottom}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isDraggingButton) return;

        isDraggingButton = false;

        configButton.style.opacity = '1';
        configButton.style.cursor = 'pointer';

        const rect = configButton.getBoundingClientRect();
        const newRight = window.innerWidth - rect.right;
        const newBottom = window.innerHeight - rect.bottom;

        saveButtonPosition({ right: newRight, bottom: newBottom });
    });

    configButton.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });

    // 配置存储系统
    const loadHotkey = () => {
        const defaultHotkey = { key: 's', ctrl: true, shift: false, alt: false };
        try {
            const saved = GM_getValue('hotkey');
            return saved || defaultHotkey;
        } catch {
            return defaultHotkey;
        }
    };

    const saveHotkey = (hk) => GM_setValue('hotkey', hk);

    let hotkey = loadHotkey();
    let isSelectionMode = false;
    let startX, startY;
    let overlay, selectionBox;
    let isDragging = false;

    // 配置对话框
    const showHotkeyDialog = () => {
        const input = prompt('请输入组合键（例如：Ctrl+Alt+S）：\n支持修饰键：Ctrl/Alt/Shift',
                            formatHotkey(hotkey));
        if (!input) return;

        const parsed = parseHotkey(input);
        if (parsed?.key) {
            hotkey = parsed;
            saveHotkey(hotkey);
            GM_notification({
                text: `✅ 快捷键已设置为：${formatHotkey(hotkey)}`,
                timeout: 2000
            });
        } else {
            alert('❌ 无效格式！正确示例：Ctrl+Shift+Q');
        }
    };

    // 组合键解析器
    const parseHotkey = (input) => {
        const result = { key: null, ctrl: false, alt: false, shift: false };
        const parts = input.trim()
            .toLowerCase()
            .replace(/control/g, 'ctrl')
            .split('+');

        for (const part of parts) {
            switch(part) {
                case 'ctrl': result.ctrl = true; break;
                case 'alt': result.alt = true; break;
                case 'shift': result.shift = true; break;
                default:
                    if (!result.key) {
                        result.key = part === ' ' ? 'space' : part.replace(/ /g, '');
                    }
            }
        }
        return result.key ? result : null;
    };

    // 组合键格式化
    const formatHotkey = (hk) => {
        const mods = [];
        if (hk.ctrl) mods.push('Ctrl');
        if (hk.alt) mods.push('Alt');
        if (hk.shift) mods.push('Shift');
        return mods.concat(hk.key.toUpperCase()).join('+');
    };

    // 注册菜单命令
    GM_registerMenuCommand("配置快捷键", showHotkeyDialog);

    // 配置按钮点击事件
    let clickTimer = null;
    configButton.addEventListener('click', (e) => {
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            // 双击回到默认位置
            configButton.style.right = '20px';
            configButton.style.bottom = '20px';
            saveButtonPosition({ right: 20, bottom: 20 });
        } else {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                // 单击打开配置
                showHotkeyDialog();
            }, 300);
        }
    });

    // 窗口大小变化时保持按钮在视口内
    window.addEventListener('resize', () => {
        const rect = configButton.getBoundingClientRect();
        const right = window.innerWidth - rect.right;
        const bottom = window.innerHeight - rect.bottom;

        if (right < 0 || bottom < 0) {
            configButton.style.right = '20px';
            configButton.style.bottom = '20px';
            saveButtonPosition({ right: 20, bottom: 20 });
        }
    });

    // 快捷键监听
    document.addEventListener('keydown', function(e) {
        if (isSelectionMode || !hotkey?.key) return;

        const keyMatch = e.key.toLowerCase() === hotkey.key.toLowerCase();
        const modMatch =
            e.ctrlKey === hotkey.ctrl &&
            e.altKey === hotkey.alt &&
            e.shiftKey === hotkey.shift;

        if (keyMatch && modMatch) {
            e.preventDefault();
            e.stopImmediatePropagation();
            initSelectionMode();
        }
    }, true);

    // 选区模式实现
    const initSelectionMode = () => {
        isSelectionMode = true;

        // 创建覆盖层
        overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            zIndex: 10000,
            cursor: 'crosshair',
            background: 'transparent'
        });

        // 创建选区框
        selectionBox = document.createElement('div');
        Object.assign(selectionBox.style, {
            position: 'fixed',
            border: '2px solid #ff0000',
            backgroundColor: 'rgba(255,0,0,0.2)',
            pointerEvents: 'none',
            display: 'none'
        });

        overlay.appendChild(selectionBox);
        document.body.appendChild(overlay);

        // ESC监听
        const escHandler = (e) => {
            if (e.key === 'Escape') cleanupSelection();
        };
        document.addEventListener('keydown', escHandler);

        // 鼠标事件
        overlay.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            selectionBox.style.display = 'block';
            updateSelectionBox(startX, startY, startX, startY);
        });

        overlay.addEventListener('mousemove', e => {
            if (!isDragging) return;
            updateSelectionBox(startX, startY, e.clientX, e.clientY);
        });

        overlay.addEventListener('mouseup', e => {
            if (!isDragging) return;
            isDragging = false;
            endSelection(e.clientX, e.clientY);
            cleanupSelection();
            document.removeEventListener('keydown', escHandler);
        });
    };

    // 辅助函数
    const updateSelectionBox = (x1, y1, x2, y2) => {
        selectionBox.style.left = `${Math.min(x1, x2)}px`;
        selectionBox.style.top = `${Math.min(y1, y2)}px`;
        selectionBox.style.width = `${Math.abs(x2 - x1)}px`;
        selectionBox.style.height = `${Math.abs(y2 - y1)}px`;
    };

    const endSelection = (endX, endY) => {
        const rect = {
            left: Math.min(startX, endX),
            right: Math.max(startX, endX),
            top: Math.min(startY, endY),
            bottom: Math.max(startY, endY)
        };

        // 收集带坐标的链接信息
        const linksWithPosition = [];

        document.querySelectorAll('a').forEach(link => {
            const linkRect = link.getBoundingClientRect();
            if (!(linkRect.right < rect.left ||
                  linkRect.left > rect.right ||
                  linkRect.bottom < rect.top ||
                  linkRect.top > rect.bottom)) {

                if (!isPaginationLink(link) && !isMetadataLink(link)) {
                    const url = normalizeUrl(link.href);
                    if (url) {
                        linksWithPosition.push({
                            url: url,
                            top: linkRect.top,
                            left: linkRect.left
                        });
                    }
                }
            }
        });

        // 按坐标排序（优先Y轴，其次X轴）
        const sortedLinks = linksWithPosition.sort((a, b) => {
            const verticalDiff = a.top - b.top;
            return verticalDiff !== 0 ? verticalDiff : a.left - b.left;
        });

        // 去重并保持顺序
        const uniqueUrls = new Set();
        const orderedUrls = [];
        sortedLinks.forEach(link => {
            if (!uniqueUrls.has(link.url)) {
                uniqueUrls.add(link.url);
                orderedUrls.push(link.url);
            }
        });

        // 顺序打开链接
        if (orderedUrls.length > 0) {
            GM_notification({
                title: '正在打开链接',
                text: `即将打开 ${orderedUrls.length} 个唯一链接`,
                timeout: 1500
            });

            // 添加延迟避免弹出窗口被阻止
            orderedUrls.forEach((url, index) => {
                setTimeout(() => GM_openInTab(url, true), index * 100);
            });
        }
    };

    // 页码链接检测函数
    function isPaginationLink(link) {
        // 方式1：检测纯数字（1-3位）
        if (/^\s*\d{1,3}\s*$/.test(link.textContent)) return true;

        // 方式2：检测常见分页class
        const classKeywords = ['page', 'pagenum', 'paginate'];
        if (classKeywords.some(kw => link.className.includes(kw))) return true;

        // 方式3：检测父级容器
        let el = link.parentElement;
        const paginationKeywords = ['pagination', 'pages', 'pager'];
        while (el) {
            const cls = el.className || '';
            if (paginationKeywords.some(kw => cls.includes(kw))) {
                return true;
            }
            el = el.parentElement;
        }

        return false;
    }

    // 元数据链接过滤（用户名、分类标签、时间等非标题链接）
    function isMetadataLink(link) {
        const text = link.textContent.trim();
        const href = link.href;
        const className = link.className.toLowerCase();
        const pathname = new URL(href).pathname;

        // 检测时间链接（如"5分钟前"、"几秒钟前"、"1小时前"等）
        if (/^\d+\s*(秒|分钟|小时|天|周|月|年)前/.test(text)) return true;
        if (/^几?(秒|分钟|小时|天|周|月|年)前/.test(text)) return true;
        if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return true;
        if (/^just now$/i.test(text)) return true;
        if (/^\d+ (second|minute|hour|day|week|month|year)s? ago$/i.test(text)) return true;

        // 检测用户名主页链接（直接按URL路径过滤）
        const userPathPatterns = ['/member/', '/user/', '/members/', '/u/', '/profile/', '/@', '/people/'];
        if (userPathPatterns.some(p => pathname.includes(p))) return true;

        // 检测分类/板块链接（如V2EX的/go/、Reddit的/r/等）
        const boardPathPatterns = ['/go/', '/c/', '/category/', '/board/', '/forum/', '/group/', '/r/'];
        if (boardPathPatterns.some(p => pathname.startsWith(p) || pathname.includes(p))) return true;

        // 检测短文本链接（通常是标签、分类、用户名）
        if (text.length <= 6) return true;

        // 检测纯链接文本（只有单个词或短语，无空格）
        if (text.length <= 15 && !/[\s,;。！？]/.test(text)) return true;

        // 检测常见元数据class关键词
        const metaClassKeywords = [
            'user', 'author', 'name', 'avatar', 'tag', 'category',
            'label', 'badge', 'time', 'date', 'ago', 'meta', 'info',
            'reply-from', 'replier', 'member', 'profile'
        ];
        if (metaClassKeywords.some(kw => className.includes(kw))) return true;

        // 检测父级元素的元数据特征
        let el = link.parentElement;
        for (let i = 0; i < 5 && el; i++) {
            const elClass = el.className?.toLowerCase() || '';
            if (metaClassKeywords.some(kw => elClass.includes(kw))) return true;
            el = el.parentElement;
        }

        // 检测"最后回复来自"模式（链接紧跟在该文本之后）
        const prevSibling = link.previousSibling;
        if (prevSibling && prevSibling.textContent &&
            /最后回复来自|last reply|reply from/i.test(prevSibling.textContent)) {
            return true;
        }

        return false;
    }

    // URL标准化函数
    function normalizeUrl(url) {
        try {
            const u = new URL(url);
            // 移除常见跟踪参数
            const trackingParams = [
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'yclid',
                'from', 'share_id', 'timestamp', 'source', 'medium'
            ];
            trackingParams.forEach(param => {
                u.searchParams.delete(param);
            });
            
            // 统一协议为https（如果原协议是http）
            if (u.protocol === 'http:') {
                u.protocol = 'https:';
            }
            
            // 移除默认端口
            if ((u.protocol === 'https:' && u.port === '443') ||
                (u.protocol === 'http:' && u.port === '80')) {
                u.port = '';
            }
            
            // 移除尾部斜杠（除非是根路径）
            if (u.pathname !== '/' && u.pathname.endsWith('/')) {
                u.pathname = u.pathname.slice(0, -1);
            }
            
            // 移除锚点
            u.hash = '';
            
            return u.toString();
        } catch {
            return null; // 无效URL跳过
        }
    }

    const cleanupSelection = () => {
        isSelectionMode = false;
        isDragging = false;
        overlay?.remove();
    };
})();