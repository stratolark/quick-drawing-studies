import './styles.css';
import { startApp } from './app.js';
import { createLearning } from './learn/controller.js';
import * as observe from './learn/observe-ui.js';
import * as review from './learn/review-ui.js';
import * as summary from './learn/summary-ui.js';
import { renderHomeV2, renderProgressPage } from './learn/home-ui.js';
import { createFreePractice } from './free/practice.js';
import { $ } from './util.js';

const api = startApp();
const learning = createLearning(api, { observe, review, summary });
api.onHome(() => renderHomeV2(learning));
const free = createFreePractice(api);
api.onHome(free.renderSetup);
observe.bindObserveControls(() => learning);

$('#openProgress').addEventListener('click', () => {
  renderProgressPage(learning);
  api.show('progress');
  $('#progress').scrollTop = 0;
});
$('#progressHome').addEventListener('click', () => {
  api.show('home');
  api.renderHome();
});
$('#lsHome').addEventListener('click', () => learning.finish());
$('#lsAgain').addEventListener('click', () => {
  const { type, objectiveId, source } = learning.live;
  learning.finish();
  learning.start({ type, objectiveId, source });
});
api.renderHome();
