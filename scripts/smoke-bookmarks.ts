import type { BookmarkNode } from '../shared/types';

export const smokeBookmarks: BookmarkNode[] = [
  {
    id: 'smoke-folder',
    title: 'Agent · 从想法到实践',
    children: [
      {
        id: 'smoke-1',
        title: '使用 agent 查找适合分镜的真实素材',
        url: 'https://carri1sun.github.io/posts/resource-optimize/',
      },
      {
        id: 'smoke-2',
        title: 'Agent Evals 是一个伟大的工作',
        url: 'https://carri1sun.github.io/posts/agent-evals-practice/',
      },
      {
        id: 'smoke-3',
        title: 'Agent 的 Plan 系统的产品设计上的思考点',
        url: 'https://carri1sun.github.io/posts/agent-plan-design/',
      },
    ],
  },
];
