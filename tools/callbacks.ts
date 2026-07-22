// 统一保存供各个工具调用的回调函数
export const GlobalCallbacks: {
  askUser?: (questions: string[]) => Promise<string>;
  reportDraft?: (report: string) => Promise<string>;
  visualsDraft?: (draft: string) => Promise<string>;
} = {};
