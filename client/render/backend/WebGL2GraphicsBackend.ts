import PicoGL, { App as PicoApp, Timer } from "picogl";

import { isSafari } from "../../common/utils/DeviceUtil";
import { type DrawBackend, createDrawBackend } from "../DrawBackend";
import { optimizeAssumingFlatsHaveSameFirstAndLastData } from "../render/constants";
import type { GraphicsBackend } from "./GraphicsBackend";

export interface WebGL2BackendInitOptions {
    clearColor: ArrayLike<number>;
}

export interface WebGL2BackendResources {
    app: PicoApp;
    gl: WebGL2RenderingContext;
    timer: Timer;
    hasMultiDraw: boolean;
    drawBackend: DrawBackend;
}

/**
 * Owns WebGL2/PicoGL device creation and backend-specific base state.
 *
 * Higher-level scene resources still live on WebGLOsrsRenderer for now. Keeping
 * context creation behind this object is the first migration seam needed for a
 * second graphics API without changing existing render behavior.
 */
export class WebGL2GraphicsBackend implements GraphicsBackend {
    readonly kind = "webgl2" as const;
    readonly label = "WebGL2";

    private resources?: WebGL2BackendResources;

    get initialized(): boolean {
        return this.resources !== undefined;
    }

    init(
        canvas: HTMLCanvasElement,
        options: WebGL2BackendInitOptions,
    ): WebGL2BackendResources {
        this.dispose();

        const app = PicoGL.createApp(canvas);
        (app as any).width = canvas.width;
        (app as any).height = canvas.height;

        const gl = app.gl as WebGL2RenderingContext;

        // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#use_webgl_provoking_vertex_when_its_available
        optimizeAssumingFlatsHaveSameFirstAndLastData(gl);

        const timer = app.createTimer();

        // Safari's Metal ANGLE advertises WEBGL_multi_draw but can fail at draw
        // time with attribute-type mismatches, so preserve the existing guard.
        const state: any = app.state;
        const multiDrawExtension = isSafari ? null : gl.getExtension("WEBGL_multi_draw");
        PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED = multiDrawExtension;
        state.extensions.multiDrawInstanced = multiDrawExtension;

        const hasMultiDraw = !!multiDrawExtension;
        const drawBackend = createDrawBackend(hasMultiDraw);
        drawBackend.init(app, gl);

        if (!multiDrawExtension) {
            console.warn(
                isSafari
                    ? "Disabling WEBGL_multi_draw on Safari/WebKit; using single-draw fallback."
                    : "WEBGL_multi_draw extension not available! Rendering may not work correctly. " +
                          "Falling back to single-draw rendering; this is slower but supported.",
            );
        }

        gl.getExtension("EXT_float_blend");

        app.enable(PicoGL.CULL_FACE);
        app.enable(PicoGL.DEPTH_TEST);
        app.depthFunc(PicoGL.LEQUAL);

        app.enable(PicoGL.BLEND);
        app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
        app.clearColor(
            options.clearColor[0] ?? 0,
            options.clearColor[1] ?? 0,
            options.clearColor[2] ?? 0,
            options.clearColor[3] ?? 1,
        );

        const resources: WebGL2BackendResources = {
            app,
            gl,
            timer,
            hasMultiDraw,
            drawBackend,
        };
        this.resources = resources;
        return resources;
    }

    dispose(): void {
        this.resources?.drawBackend.dispose();
        this.resources = undefined;
    }
}
