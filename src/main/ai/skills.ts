import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { SkillDef } from './types'

/**
 * 技能包：USER_DIR/skills/*.md
 * front-matter 描述「什么时候用」，正文是真正的操作手册。
 * AI 平时只看到索引（名字 + 一句话），需要时才 load_skill 读正文。
 */
export class SkillStore {
  dir: string

  constructor(userDir: string) {
    this.dir = join(userDir, 'skills')
    this.ensure()
  }

  private ensure() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  list(): SkillDef[] {
    this.ensure()
    const out: SkillDef[] = []
    for (const name of readdirSync(this.dir)) {
      if (!/\.md$/i.test(name)) continue
      const file = join(this.dir, name)
      try {
        const raw = readFileSync(file, 'utf-8')
        out.push(parseSkill(raw, name))
      } catch {
        /* 单个文件坏了不影响其它技能 */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  get(name: string): SkillDef | null {
    const key = name.trim().toLowerCase()
    return this.list().find((s) => s.name.toLowerCase() === key || s.file.toLowerCase() === `${key}.md`) || null
  }

  save(input: { name: string; description?: string; when?: string; body: string }): SkillDef {
    this.ensure()
    const name = sanitize(input.name) || '未命名技能'
    const file = `${name}.md`
    const front = [
      '---',
      `name: ${name}`,
      `description: ${(input.description || '').replace(/\n/g, ' ').trim()}`,
      `when: ${(input.when || '').replace(/\n/g, ' ').trim()}`,
      '---',
      '',
      input.body.trim(),
      ''
    ].join('\n')
    writeFileSync(join(this.dir, file), front, 'utf-8')
    return parseSkill(front, file)
  }

  remove(name: string): boolean {
    const hit = this.get(name)
    if (!hit) return false
    try {
      rmSync(join(this.dir, hit.file), { force: true })
      return true
    } catch {
      return false
    }
  }

  /** 注入 system prompt 的索引，控制在可读的一小段 */
  indexText(): string {
    const all = this.list()
    if (!all.length) return ''
    return all
      .map((s) => `- ${s.name}${s.when ? ` — 适用：${s.when}` : s.description ? ` — ${s.description}` : ''}`)
      .join('\n')
  }

  /** 首次运行放几个能立刻用的示例，空目录时才写 */
  seed() {
    this.ensure()
    if (readdirSync(this.dir).some((f) => f.endsWith('.md'))) return
    const samples: { name: string; description: string; when: string; body: string }[] = [
      {
        name: '排查记录归档',
        description: '把聊天里的排查过程整理成可复用的故障笔记',
        when: '用户说「整理成笔记 / 归档一下 / 写成复盘」',
        body: `# 排查记录归档

## 步骤
1. 先用 \`search_docs\` 确认库里有没有同一问题的旧记录，有就先读，避免重复。
2. 按下面骨架写，缺的信息写「未确认」，不要编造：
   - **现象**：谁在什么时候看到什么（保留原始报错、状态码）
   - **影响面**：接口 / 用户比例 / 时间窗
   - **排查路径**：按时间顺序列命令与观察结果
   - **根因**：一句话，能定位到具体组件
   - **处置**：改了什么，怎么验证
   - **待办**：- [ ] 形式，谁做什么
3. 用 \`create_doc\` 新建，标题格式：\`<组件> <问题关键词> 复盘\`。
4. 如果库里有同类旧文档，用 \`edit_doc\` 在旧文档末尾追加「后续」，不要另起一篇。

## 约束
- 命令、日志、配置原样保留，不改写不翻译。
- 时间统一到「10-30 22:40」这种格式。
- 不超过 400 行，长内容拆到子文档。`
      },
      {
        name: '周报生成',
        description: '把一周的笔记汇总成可直接发的周报',
        when: '用户说「写周报 / 本周总结 / 汇报一下」',
        body: `# 周报生成

## 步骤
1. \`list_tree\` 看目录结构，找本周相关的文档（按标题和目录判断）。
2. \`read_doc\` 读其中 3-6 篇，取事实：做了什么、结果如何、卡在哪。
3. 按这个结构输出，不要加寒暄：
   - **本周完成**（3-5 条，每条一句结论 + 关键数字）
   - **问题与风险**（没解决的，说清卡点）
   - **下周计划**（- [ ] 形式）
4. 用户要求写进文件时才 \`create_doc\`，标题 \`<周数> 周报\`。

## 约束
- 只写材料里有的，没有就写「无」。
- 每条不超过 40 字，领导要的是结论不是过程。`
      },
      {
        name: 'Mermaid 修复',
        description: '修好渲染失败的 mermaid 图',
        when: '用户说「图渲染不出来 / mermaid 报错」',
        body: `# Mermaid 修复

## 步骤
1. 读文档，定位 \`\`\`mermaid 代码块。
2. 按下面清单逐条排查（这是最常见的四类错误）：
   - 节点文字里有 \`()[]{}"\` 等字符没加引号 → 用 \`A["文字(括号)"]\`
   - \`graph TD\` 里用了 \`end\` 作为节点名 → 改名或加引号
   - 箭头重复或悬空（\`A --> \` 结尾）→ 补全目标节点
   - 中文标点混进语法位置（全角冒号、逗号）→ 换成半角
3. 用 \`edit_doc\` 只替换出问题的那几行，不要重画整张图。
4. 在回答里说明改了哪一处、为什么。`
      }
    ]
    for (const s of samples) this.save(s)
  }
}

function parseSkill(raw: string, file: string): SkillDef {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  let body = text
  if (m) {
    body = m[2] || ''
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return {
    name: meta.name || basename(file, '.md'),
    description: meta.description || '',
    when: meta.when || '',
    body: body.trim(),
    file
  }
}

function sanitize(name: string): string {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 40)
}
