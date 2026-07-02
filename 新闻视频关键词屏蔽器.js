// ==UserScript==
// @name         新闻/视频关键词屏蔽器
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  模糊匹配关键词的新闻/视频卡片，鼠标悬停显示
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/**
 * News Blocker — 油猴脚本
 * =======================
 * 功能：在任意网页上，根据关键词模糊匹配新闻/视频卡片或标签，
 *       将匹配到的元素模糊化（高斯模糊+灰度），鼠标悬停时显示。
 *
 * 策略（三级决策链）：
 *   Lv.1 标签检测 → 元素很小、class 含 tag/label/badge → 仅模糊该标签
 *   Lv.2 卡片检测 → 语义容器 article/section/li + 大小合理 → 模糊整张卡片
 *   Lv.3 上溯回退 → 逐层向上找尺寸合理的容器
 *
 * 技术要点：
 *   - MutationObserver 监听动态加载内容
 *   - IntersectionObserver 延迟处理不可见元素
 *   - 中文关键词用 includes，英文用 \b 整词匹配
 */

(function () {
    'use strict';

    /* ================================================================
     *  配置常量
     * ================================================================ */

    /** GM_setValue 存储键名 */
    const STORAGE_KEY = 'hiddenKeywords';
    /** 模糊滤镜效果 */
    const BLUR_STYLE = 'blur(12px) grayscale(80%)';

    /** 当前内存中的屏蔽词列表 */
    let keywords = [];

    /** 是否已完成文档级事件委托的初始化 */
    let delegationReady = false;

    /* ================================================================
     *  屏蔽词持久化（GM_setValue / GM_getValue）
     * ================================================================ */

    /** 从 Tampermonkey 存储中读取屏蔽词列表 */
    function loadKeywords() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '[]');
            keywords = JSON.parse(raw);
            if (!Array.isArray(keywords)) keywords = [];
        } catch (e) {
            keywords = [];
        }
        console.log('[News Blocker] keywords loaded:', keywords);
    }

    /** 将屏蔽词列表写入持久化存储 */
    function saveKeywords() {
        GM_setValue(STORAGE_KEY, JSON.stringify(keywords));
    }

    /** 添加一个屏蔽词（去重），返回是否成功 */
    function addKeyword(word) {
        const trimmed = word.trim();
        if (!trimmed || keywords.includes(trimmed)) return false;
        keywords.push(trimmed);
        saveKeywords();
        return true;
    }

    /** 删除一个屏蔽词，返回是否成功 */
    function removeKeyword(word) {
        const idx = keywords.indexOf(word);
        if (idx === -1) return false;
        keywords.splice(idx, 1);
        saveKeywords();
        return true;
    }

    /* ================================================================
     *  匹配引擎
     * ================================================================ */

    /**
     * 判断文本是否匹配任一屏蔽词
     * - 英文关键词：整词匹配 (\b 单词边界)，避免 "man" 误杀 "manager"
     * - 中文/非 ASCII 关键词：简单 includes 子串匹配
     */
    function matchesKeyword(text) {
        const lower = text.toLowerCase();
        return keywords.some(kw => {
            const kwLower = kw.toLowerCase();
            // 纯 ASCII 关键词使用 \b 正则整词匹配
            if (/^[\x00-\x7F]+$/.test(kwLower)) {
                const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp('\\b' + escaped + '\\b', 'i').test(lower);
            }
            // 含中文的关键词直接子串匹配
            return lower.includes(kwLower);
        });
    }

    /* ================================================================
     *  目标元素定位（三级决策链）
     * ================================================================ */

    /**
     * 从匹配文本的父元素出发，确定要模糊的 DOM 元素
     *
     * @param {Element} el — 匹配文本的父元素
     * @returns {Element} — 要模糊的目标元素
     */
    function findCard(el) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').trim();

        // -------------------------------------------------------------
        // Level 1: 标签检测
        // 检测元素 class 是否含 tag/label/badge/topic 等标记类名
        // 且尺寸很小（< 250px 宽），说明是单个标签而非整张卡片
        // 典型场景：B站视频下方的"华为"话题标签
        // -------------------------------------------------------------
        const tagSelectors = [
            '[class*="tag"]', '[class*="label"]', '[class*="keyword"]',
            '[class*="badge"]', '[class*="topic"]'
        ];
        for (const sel of tagSelectors) {
            const match = el.closest(sel);
            if (match) {
                const mr = match.getBoundingClientRect();
                if (mr.width > 0 && mr.width < 250 && mr.height < 60) {
                    return match;
                }
            }
        }
        // 兜底：没有任何 class 匹配，但元素本身极小且文本很短
        // 例如搜索框旁的"华为"标签、菜单项
        if (rect.width > 0 && rect.width < 200 && rect.height < 50 && text.length < 30) {
            return el;
        }

        // -------------------------------------------------------------
        // Level 2: 卡片检测
        // 在 DOM 树中向上寻找语义容器（article/section/li 等）
        // 且尺寸合理（< 85% 屏幕宽），说明是新闻卡片/视频卡片
        // 典型场景：百度新闻中"华为"相关文章的卡片条目
        // -------------------------------------------------------------
        const cardSelectors = [
            'article', 'section',
            '[class*="card"]', '[class*="item"]', '[class*="post"]',
            '[class*="news"]', '[class*="video"]', '[class*="article"]',
            '[class*="entry"]', '[class*="result"]', '[class*="story"]',
            '[class*="media"]', '[class*="list-item"]',
            '[role="article"]', '[role="listitem"]',
            'li'
        ];
        for (const sel of cardSelectors) {
            const match = el.closest(sel);
            if (match) {
                const mr = match.getBoundingClientRect();
                // 防止匹配到整个页面布局容器（完整宽度响应式容器）
                if (mr.width < vw * 0.85 && mr.height < vh * 0.5) {
                    return match;
                }
                break; // 匹配到疑似容器但过大，跳出改用回退策略
            }
        }

        // -------------------------------------------------------------
        // Level 3: 上溯回退
        // 既无标签样式也无卡片语义，则逐层向上查找
        // 策略：优先找标题元素（H1-H6、A、P）或宽度 < 65% 屏宽的容器
        // 最多走 5 层，避免走到 body
        // -------------------------------------------------------------
        let current = el;
        for (let i = 0; i < 5 && current && current !== document.body; i++) {
            const r = current.getBoundingClientRect();
            const tag = current.tagName;
            if (r.width < vw * 0.65 || ['A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P'].includes(tag)) {
                return current;
            }
            current = current.parentElement;
        }
        return el;
    }

    /* ================================================================
     *  可见性检测
     * ================================================================ */

    /**
     * 判断元素是否在视口内（或附近）
     * 用于决定是立即模糊还是通过 IntersectionObserver 延迟处理
     */
    function isVisible(el) {
        if (!el || el === document.body) return true;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const threshold = -100;               // 允许视口外 100px 范围
        return rect.bottom > threshold && rect.top < window.innerHeight + threshold;
    }

    /* ================================================================
     *  模糊处理
     * ================================================================ */

    /**
     * 对元素施加模糊效果
     * - 添加 CSS filter: blur + grayscale
     * - 鼠标悬停 (mouseenter) 取消模糊以查看内容
     * - 鼠标离开 (mouseleave) 恢复模糊
     * - 通过 data-nb-processed 属性避免重复处理
     */
    function blurElement(el) {
        if (!el || el === document.body || el === document.documentElement) return;
        if (el.hasAttribute('data-nb-processed')) return;

        el.setAttribute('data-nb-processed', 'true');
        el.style.cursor = 'pointer';
        el.style.transition = 'filter 0.2s ease';

        // 如果鼠标当前正悬停在此元素上，跳过模糊
        // 解决 SPA 框架（React/Vue）重渲染节点时的闪烁问题
        if (el.matches(':hover')) return;

        el.style.filter = BLUR_STYLE;
        el.style.userSelect = 'none';
    }

    /* ================================================================
     *  懒加载处理（IntersectionObserver）
     * ================================================================ */

    /**
     * 仅对进入视口的元素施加模糊，避免一次性处理大量不可见元素
     * rootMargin: 200px → 在元素进入视口前 200px 即预处理
     */
    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                blurElement(entry.target);
                io.unobserve(entry.target);
            }
        }
    }, { rootMargin: '200px' });

    /* ================================================================
     *  页面扫描
     * ================================================================ */

    /**
     * 使用 TreeWalker 遍历页面所有文本节点：
     *   1. 排除 script/style/meta 标签
     *   2. 排除已处理的元素（data-nb-processed）
     *   3. 匹配关键词 → 定位目标元素 → 视口内立即模糊，否则交给 IO
     *
     * 每次扫描都会重新走全量文本节点（性能安全，已处理元素会跳过）
     */
    function scanPage() {
        if (!keywords.length) return;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent === document.body || parent.closest('[data-nb-processed]')) continue;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'META') continue;
            if (!node.textContent.trim()) continue;
            if (!matchesKeyword(node.textContent)) continue;

            const card = findCard(parent);
            if (isVisible(card)) {
                blurElement(card);
            } else {
                io.observe(card);
            }
        }
    }

    /* ================================================================
     *  初始化与观察器
     * ================================================================ */

    function init() {
        loadKeywords();
        setupMenu();

        if (!document.body) {
            console.warn('[News Blocker] body not ready, retrying...');
            setTimeout(init, 500);
            return;
        }

        // 首次扫描
        scanPage();

        // 监听 DOM 变化，动态加载的内容自动扫描
        const mo = new MutationObserver(() => scanPage());
        mo.observe(document.body, { childList: true, subtree: true });

        // 文档级事件委托：悬停显示 / 离开模糊（仅绑定一次）
        if (!delegationReady) {
            delegationReady = true;
            // 使用 mouseover/mouseout 而非 mouseenter/mouseleave，
            // 因为前者会冒泡，能避免 SPA 重渲染导致监听器丢失
            document.addEventListener('mouseover', function onOver(e) {
                const el = e.target.closest('[data-nb-processed]');
                if (el && el.style.filter !== 'none') {
                    el.style.filter = 'none';
                    el.style.userSelect = 'auto';
                }
            });
            document.addEventListener('mouseout', function onOut(e) {
                const el = e.target.closest('[data-nb-processed]');
                if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) {
                    el.style.filter = BLUR_STYLE;
                    el.style.userSelect = 'none';
                }
            });
        }

        // 额外安全扫描：某些网站可能在页面加载完成后才渲染内容
        setTimeout(scanPage, 1500);
        setTimeout(scanPage, 4000);
        window.addEventListener('load', scanPage);
    }

    /* ================================================================
     *  油猴菜单
     * ================================================================ */

    function setupMenu() {
        // 添加屏蔽词
        GM_registerMenuCommand('➕ 添加屏蔽词', () => {
            const input = prompt('输入要屏蔽的关键词（公司名/人名）：');
            if (input && addKeyword(input)) {
                alert(`已添加: ${input}`);
                scanPage();          // 添加后立即扫描
            }
        });

        // 查看/删除屏蔽词
        GM_registerMenuCommand('📋 查看/删除屏蔽词', () => {
            if (!keywords.length) { alert('当前没有屏蔽词。'); return; }
            const list = keywords.map((k, i) => `${i + 1}. ${k}`).join('\n');
            const input = prompt(`当前屏蔽词列表（输入编号或词来删除，留空取消）：\n\n${list}`);
            if (!input) return;
            // 支持按序号删除或按文本删除
            const num = parseInt(input, 10);
            if (!isNaN(num) && num >= 1 && num <= keywords.length) {
                const removed = keywords[num - 1];
                removeKeyword(removed);
                alert(`已删除: ${removed}`);
            } else if (keywords.includes(input.trim())) {
                removeKeyword(input.trim());
                alert(`已删除: ${input.trim()}`);
            } else {
                alert('未找到匹配的词。');
            }
        });

        // 清空所有屏蔽词
        GM_registerMenuCommand('🗑️ 清空所有屏蔽词', () => {
            if (confirm('确定清空所有屏蔽词？')) {
                keywords = [];
                saveKeywords();
                alert('已清空。');
            }
        });
    }

    /* ================================================================
     *  入口
     * ================================================================ */

    // 等待 DOM 就绪后启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
