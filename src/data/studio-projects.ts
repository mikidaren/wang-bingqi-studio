export interface StudioProject {
  id: string;
  title: string;
  href: string;
  description: string;
  eyebrow: string;
  action?: string;
  visual?: 'resources' | 'ice' | 'geometry';
}

// Add an entry here to include it on the homepage and shared navigation.
// Omitting `visual` uses the neutral geometric illustration.
export const studioProjects: readonly StudioProject[] = [
  {
    id: 'cloud-resources',
    title: '云资源',
    href: '/category/process/',
    description: '计算、存储与开发服务，集中查看配置和控制台入口。',
    eyebrow: 'RESOURCES',
    action: '打开资源面板',
    visual: 'resources',
  },
  {
    id: 'harbin-ice-world',
    title: '哈尔滨冰雪大世界',
    href: '/category/project/',
    description: '从规划到建筑、施工的冰雪大世界设计工作台。',
    eyebrow: 'ARCHITECTURE',
    action: '进入项目工作台',
    visual: 'ice',
  },
];
