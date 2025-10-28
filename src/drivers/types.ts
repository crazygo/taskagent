
/**
 * Driver 名称类型
 * - chat: 内置聊天（原 manual）
 * - agent: Claude Agent SDK 对话
 * - plan-review-do: 计划-审查-执行模式
 * - 其余：占位模式
 *
 * manual 仍保留以兼容旧的 CLI 参数，映射到 chat。
 */
export type DriverName =
  | 'chat'
  | 'agent'
  | 'manual'
  | 'plan-review-do'
  | 'story'
  | 'ux'
  | 'architecture'
  | 'tech-plan';

/**
 * Driver 枚举（用于 UI 显示）
 */
export enum Driver {
  CHAT = 'Chat',
  AGENT = 'Agent',
  PLAN_REVIEW_DO = 'Plan-Review-DO',
  STORY = 'Story',
  UX = 'UX',
  ARCHITECTURE = 'Architecture',
  TECH_PLAN = 'Tech Plan',
}

/**
 * 将 DriverName 映射到 Driver 枚举
 */
export function getDriverEnum(name: DriverName): Driver {
  const map: Record<DriverName, Driver> = {
    'chat': Driver.CHAT,
    'manual': Driver.CHAT,
    'agent': Driver.AGENT,
    'plan-review-do': Driver.PLAN_REVIEW_DO,
    'story': Driver.STORY,
    'ux': Driver.UX,
    'architecture': Driver.ARCHITECTURE,
    'tech-plan': Driver.TECH_PLAN,
  };
  return map[name];
}

/**
 * 将 Driver 枚举映射到 DriverName
 */
export function getDriverName(driver: Driver): DriverName {
  const map: Record<Driver, DriverName> = {
    [Driver.CHAT]: 'chat',
    [Driver.AGENT]: 'agent',
    [Driver.PLAN_REVIEW_DO]: 'plan-review-do',
    [Driver.STORY]: 'story',
    [Driver.UX]: 'ux',
    [Driver.ARCHITECTURE]: 'architecture',
    [Driver.TECH_PLAN]: 'tech-plan',
  };
  return map[driver];
}
