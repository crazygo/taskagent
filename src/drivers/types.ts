
/**
 * Driver 名称类型
 * - manual: 直接对话模式（现有逻辑）
 * - plan-review-do: 计划-审查-执行模式
 * - l2+: 自动提交模式（未来实现）
 * - custom: 自定义模式（未来实现）
 */
export type DriverName = 'manual' | 'plan-review-do';

/**
 * Driver 枚举（用于 UI 显示）
 */
export enum Driver {
  MANUAL = 'Agent',
  PLAN_REVIEW_DO = 'Plan-Review-DO',
}

/**
 * 将 DriverName 映射到 Driver 枚举
 */
export function getDriverEnum(name: DriverName): Driver {
  const map: Record<DriverName, Driver> = {
    'manual': Driver.MANUAL,
    'plan-review-do': Driver.PLAN_REVIEW_DO,
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
  };
  return map[driver];
}
