/*
 * EntryAbility — the app's entry point.
 *
 * openGym keeps everything in the WebView, so this does the little that belongs to the app
 * rather than the page: the window's own settings (the app is dark, edge to edge), the
 * lifecycle events the App plugin reports to the page, and the files directory the page's
 * bridge writes into.
 */

import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'openGym';

export default class EntryAbility extends UIAbility {
  /**
   * The stage, kept here.
   *
   * API 26's UIAbility has no `windowStage` property of its own any more — the stage comes
   * in as an argument and, unless it is kept, it is gone by the time the window is ready.
   */
  private stage: window.WindowStage | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, 'onCreate');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(0x0000, TAG, 'onWindowStageCreate');
    this.stage = windowStage;
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(0x0000, TAG, 'loadContent failed: %{public}s', err.message);
        return;
      }
      hilog.info(0x0000, TAG, 'loadContent ok');
      // The window is drawn edge to edge, the way the app's own layout expects on the
      // other phones. It can only happen once the stage exists, so it goes here.
      this.setWindowLayout();
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(0x0000, TAG, 'onWindowStageDestroy');
    this.stage = undefined;
  }

  onForeground(): void {
    hilog.info(0x0000, TAG, 'onForeground');
  }

  onBackground(): void {
    hilog.info(0x0000, TAG, 'onBackground');
  }

  onDestroy(): void {
    hilog.info(0x0000, TAG, 'onDestroy');
  }

  /**
   * The window itself: dark, and drawn edge to edge so the app's own layout reaches the
   * corners the way it does on the other phones.
   */
  private async setWindowLayout(): Promise<void> {
    const stage = this.stage;
    if (!stage) {
      return;
    }
    try {
      const mainWindow: window.Window = await stage.getMainWindow();
      await mainWindow.setWindowLayoutFullScreen(true);
    } catch (err) {
      hilog.error(0x0000, TAG, 'setWindowLayoutFullScreen failed: %{public}s',
        (err as BusinessError).message);
    }
  }
}
