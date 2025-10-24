
/**
 * Driver 名称类型
 * - manual: 直接对话模式（现有逻辑）
 * - plan-review-do: 计划-审查-执行模式
 * - l2+: 自动提交模式（未来实现）
 * - custom: 自定义模式（未来实现）
 */
export type DriverName = 'manual' | 'plan-review-do' | 'l2+' | 'custom';

/**
 * Driver 枚举（用于 UI 显示）
 */
export enum Driver {
  MANUAL = 'Manual',
  PLAN_REVIEW_DO = 'Plan-Review-DO',
  AUTO_COMMIT = 'L2+',
  CUSTOM = 'Custom',
}

/**
 * 将 DriverName 映射到 Driver 枚举
 */
export function getDriverEnum(name: DriverName): Driver {
  const map: Record<DriverName, Driver> = {
    'manual': Driver.MANUAL,
    'plan-review-do': Driver.PLAN_REVIEW_DO,
    'l2+': Driver.AUTO_COMMIT,
    'custom': Driver.CUSTOM,
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
    [Driver.AUTO_COMMIT]: 'l2+',
    [Driver.CUSTOM]: 'custom',
  };
  return map[driver];
}
