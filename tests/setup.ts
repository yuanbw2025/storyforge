/**
 * Vitest 全局 setup
 *
 * - 加载 fake-indexeddb 让 Dexie 在 Node 测试环境中可用
 * - 任何依赖 IndexedDB 的测试(stores / lifecycle / 反例测试)直接 import db 即可
 */
import 'fake-indexeddb/auto'
