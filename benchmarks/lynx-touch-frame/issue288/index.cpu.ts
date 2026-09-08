import { root } from '@octanejs/lynx';

import { CpuApp } from './App.cpu.lynx.tsrx';
import './issue288.css';

void root.render(CpuApp as never);
