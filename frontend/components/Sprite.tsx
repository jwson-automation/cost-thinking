'use client';

// 32x32 のドット顔。整数倍で表示し、配属時だけ4コマの表情を切り替える。
import type { CSSProperties } from 'react';
import type { Member } from '@/lib/domain';

export function Sprite({ m, size = 32, walk = false, avatar }: { m: Member; size?: 32 | 64; walk?: boolean; avatar?: string }) {
  const key = avatar || m.avatar;
  const f = (i: number) => `url(/assets/avatars/${key}/idle-0${i}.png)`;
  const style = {
    width: size, height: size,
    ['--f1' as string]: f(1), ['--f2' as string]: f(2), ['--f3' as string]: f(3), ['--f4' as string]: f(4),
  } as CSSProperties;
  return <i className={'spr' + (walk ? ' walk' : '')} style={style} />;
}
