import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ScaffoldTemplate = 'single' | 'project' | 'assets';

export interface ScaffoldOptions {
  /** 单文件输出路径 / 项目根目录 */
  out?: string;
  template?: ScaffoldTemplate;
}

export interface ScaffoldResult {
  root: string;
  files: string[];
}

const SINGLE = `# 一个最小世界：先能跑起来，再慢慢加东西。
世界 {{名字}}
  版本 0.1
  章节 "{{名字}}"

叙事弦 信任
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 80

动作 安抚
  当 信任 > 10
  耗时 1
  效果
    信任 += 8
  描述 "把语气放慢。"

结局 安顿: 当 信任 >= 80
`;

const PROJECT_ENTRY = `引入 "modules/cast.nro"

世界 {{名字}}
  版本 0.1
  章节 "{{名字}}"
  描述 "多文件项目模板：入口只放世界本体，角色放在模块里。"

叙事弦 信任
  类型 数值 0..100
  基线 45
  悬崖 20
  安全 80

耦合 信任 → 角色.余温 反向 0.2

动作 安抚
  当 信任 > 10
  耗时 1
  效果
    信任 += 8
    角色.余温 += 2
  描述 "把语气放慢。"

结局 安顿: 当 信任 >= 80
`;

const PROJECT_MODULE = `命名空间 角色
  导出 余温

  叙事弦 余温
    类型 数值 0..100
    基线 40
    悬崖 15
    安全 75
`;

const README = `# {{名字}}

由 \`neurou init --template project\` 生成。

## 命令

\`\`\`bash
neurou check world.nro
neurou run world.nro
neurou fmt world.nro --write
\`\`\`

## 结构

- \`world.nro\`：入口，负责世界声明；
- \`modules/cast.nro\`：角色模块，只读依赖；
- \`package.json\`：本地脚本入口。
`;

const PACKAGE_JSON = `{
  "name": "{{slug}}",
  "private": true,
  "scripts": {
    "check": "neurou check world.nro",
    "run": "neurou run world.nro",
    "fmt": "neurou fmt world.nro --write"
  }
}
`;

const ASSETS_ENTRY = `世界 {{名字}}
  版本 0.1
  章节 "{{名字}}"

音频资产 雨声 "audio/rain.wav"
纹理资产 雨纹 "textures/rain.svg"

叙事弦 雨量
  类型 数值 0..100
  基线 50

视觉端口 雨幕
  参数 强度 雨量
  贴图 雨纹
  后处理 暗角 0.4 颗粒 0.2 色偏 0.1

音频端口 潮声
  参数 强度 雨量
  自动化 0.2 0.5 0.8 0.5

结局 停: 当 雨量 >= 100
`;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/** v6.18：生成单文件 / 多文件 / 资源项目模板。 */
export function scaffoldProject(name: string, options: ScaffoldOptions = {}): ScaffoldResult {
  const template = options.template ?? 'single';
  if (template === 'single') {
    const path = options.out ?? `${name}.nro`;
    write(path, SINGLE.replaceAll('{{名字}}', name));
    return { root: dirname(path), files: [path] };
  }
  const root = options.out ?? name;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '') || 'world';
  if (template === 'project') {
    const files = [
      join(root, 'world.nro'),
      join(root, 'modules', 'cast.nro'),
      join(root, 'package.json'),
      join(root, 'README.md'),
    ];
    write(files[0]!, PROJECT_ENTRY.replaceAll('{{名字}}', name));
    write(files[1]!, PROJECT_MODULE);
    write(files[2]!, PACKAGE_JSON.replaceAll('{{slug}}', slug));
    write(files[3]!, README.replaceAll('{{名字}}', name));
    return { root, files };
  }
  const files = [
    join(root, 'world.nro'),
    join(root, 'audio', 'README.md'),
    join(root, 'textures', 'README.md'),
    join(root, 'README.md'),
  ];
  write(files[0]!, ASSETS_ENTRY.replaceAll('{{名字}}', name));
  write(files[1]!, '把 rain.wav 放到这里，或改 world.nro 的音频资产路径。\n');
  write(files[2]!, '把 rain.svg 放到这里，或改 world.nro 的纹理资产路径。\n');
  write(files[3]!, README.replaceAll('{{名字}}', name));
  return { root, files };
}
