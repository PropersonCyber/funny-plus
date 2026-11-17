import { describe, expect, it } from '@rstest/core';

import { followTrip, parseChatBook, readLog, writeLog } from './chatSession.js';

describe('咕噜本机会话', () => {
  it('按行程读回对话，坏数据当成空本', () => {
    const book = parseChatBook(JSON.stringify({
      'trip-1': { turns: [{ role: 'user', text: '第二天轻松点' }, { role: 'nope', text: '丢' }], slots: { destination: '重庆' } },
    }));
    expect(readLog(book, 'trip-1').turns).toEqual([{ role: 'user', text: '第二天轻松点' }]);
    expect(readLog(book, 'trip-1').slots.destination).toBe('重庆');
    expect(parseChatBook('not-json')).toEqual({});
    expect(readLog({}, '').turns).toEqual([]);
  });

  it('从草稿生成行程后，对话跟到新行程，草稿清掉', () => {
    const book = writeLog({}, '', {
      turns: [{ role: 'user', text: '重庆玩两天' }],
      slots: { destination: '重庆' },
    });
    const next = followTrip(book, '', 'trip-new');
    expect(readLog(next, 'trip-new').turns[0].text).toBe('重庆玩两天');
    expect(next.draft).toBeUndefined();
    expect(readLog(book, '').turns).toHaveLength(1);
  });

  it('已有行程上再开一份，旧行程的对话还在', () => {
    const book = writeLog({}, 'trip-a', {
      turns: [{ role: 'user', text: '原来的' }],
      slots: {},
    });
    const next = followTrip(book, 'trip-a', 'trip-b');
    expect(readLog(next, 'trip-a').turns[0].text).toBe('原来的');
    expect(readLog(next, 'trip-b').turns[0].text).toBe('原来的');
  });
});
