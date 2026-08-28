document$.subscribe(function () {
    if (typeof svgPanZoom === "undefined") {
        console.warn("svgPanZoom is not loaded");
        return;
    }

    document.querySelectorAll(".mermaid").forEach(function (container) {
        const svg = container.querySelector("svg");

        if (!svg || svg.dataset.panzoomInitialized) {
            return;
        }

        svg.dataset.panzoomInitialized = "true";

        svgPanZoom(svg, {
            zoomEnabled: true,
            panEnabled: true,
            controlIconsEnabled: true,
            mouseWheelZoomEnabled: true,

            fit: true,
            center: true,

            minZoom: 0.5,
            maxZoom: 10,
            zoomScaleSensitivity: 0.5
        });
    });
});
