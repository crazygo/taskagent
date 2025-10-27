
/**
 * Driver 名称类型
 * - manual: 直接对话模式（现有逻辑）
 * - plan-review-do: 计划-审查-执行模式
 * - story: 用户故事模式（占位）
 * - ux: 用户体验设计模式（占位）
 * - architecture: 架构设计模式（占位）
 * - tech-plan: 技术计划模式（占位）
 * - l2+: 自动提交模式（未来实现）
 * - custom: 自定义模式（未来实现）
 */
export type DriverName = 'manual' | 'plan-review-do' | 'story' | 'ux' | 'architecture' | 'tech-plan';

/**
 * Driver 枚举（用于 UI 显示）
 */
export enum Driver {
  MANUAL = 'Agent',
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
    'manual': Driver.MANUAL,
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
    [Driver.MANUAL]: 'manual',
    [Driver.PLAN_REVIEW_DO]: 'plan-review-do',
    [Driver.STORY]: 'story',
    [Driver.UX]: 'ux',
    [Driver.ARCHITECTURE]: 'architecture',
    [Driver.TECH_PLAN]: 'tech-plan',
  };
  return map[driver];
}
