
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
  | 'glossary'
  | 'story'
  | 'ui-review'
  | 'logic-review'
  | 'data-review';

/**
 * Driver 枚举（用于 UI 显示）
 */
export enum Driver {
  CHAT = 'Chat',
  AGENT = 'Agent',
  PLAN_REVIEW_DO = 'Plan-Review-DO',
  GLOSSARY = 'Glossary',
  STORY = 'Story',
  UI_REVIEW = 'UI Review',
  LOGIC_REVIEW = 'Logic Review',
  DATA_REVIEW = 'Data Review',
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
    'glossary': Driver.GLOSSARY,
    'story': Driver.STORY,
    'ui-review': Driver.UI_REVIEW,
    'logic-review': Driver.LOGIC_REVIEW,
    'data-review': Driver.DATA_REVIEW,
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
    [Driver.GLOSSARY]: 'glossary',
    [Driver.STORY]: 'story',
    [Driver.UI_REVIEW]: 'ui-review',
    [Driver.LOGIC_REVIEW]: 'logic-review',
    [Driver.DATA_REVIEW]: 'data-review',
  };
  return map[driver];
}
