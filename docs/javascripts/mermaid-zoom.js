function enableMermaidZoom() {
    if (typeof svgPanZoom === "undefined") {
        return;
    }

    document.querySelectorAll(".mermaid svg").forEach(function (svg) {
        if (svg.dataset.zoomEnabled === "true") {
            return;
        }

        svg.dataset.zoomEnabled = "true";

        svgPanZoom(svg, {
            zoomEnabled: true,
            panEnabled: true,
            controlIconsEnabled: true,

            fit: true,
            center: true,

            minZoom: 0.5,
            maxZoom: 10,

            zoomScaleSensitivity: 0.5,
            mouseWheelZoomEnabled: true,
        });
    });
}

document.addEventListener("DOMContentLoaded", function () {
    enableMermaidZoom();

    // Mermaid may render after the initial page load.
    const observer = new MutationObserver(function () {
        enableMermaidZoom();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
});
