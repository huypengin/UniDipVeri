/**
 * Enables pan and zoom on Mermaid diagrams in Material for MkDocs.
 */
function initMermaidZoom() {
    if (typeof svgPanZoom === "undefined") {
        return;
    }

    // Find all rendered Mermaid SVGs
    const svgs = document.querySelectorAll(
        ".mermaid svg, pre.mermaid svg, div.mermaid svg",
    );

    svgs.forEach((svg) => {
        if (svg.dataset.zoomInitialized === "true") {
            return;
        }

        // Ensure SVG has an ID for svgPanZoom
        if (!svg.id) {
            svg.id = "mermaid-" + Math.random().toString(36).substr(2, 9);
        }

        svg.dataset.zoomInitialized = "true";

        // Wrap SVG in a zoom container with fixed/responsive height
        const parent = svg.parentElement;
        if (!parent.classList.contains("mermaid-zoom-container")) {
            const container = document.createElement("div");
            container.className = "mermaid-zoom-container";
            parent.insertBefore(container, svg);
            container.appendChild(svg);

            // Initialize svg-pan-zoom
            const panZoom = svgPanZoom(svg, {
                zoomEnabled: true,
                controlIconsEnabled: false, // We use custom styled HTML buttons
                fit: true,
                center: true,
                minZoom: 0.2,
                maxZoom: 10,
                zoomScaleSensitivity: 0.3,
                mouseWheelZoomEnabled: true,
                preventMouseEventsDefault: true,
            });

            // Create floating control toolbar
            const toolbar = document.createElement("div");
            toolbar.className = "mermaid-zoom-toolbar";
            toolbar.innerHTML = `
                <button type="button" class="mermaid-zoom-btn zoom-in" title="Zoom In">+</button>
                <button type="button" class="mermaid-zoom-btn zoom-out" title="Zoom Out">−</button>
                <button type="button" class="mermaid-zoom-btn zoom-reset" title="Reset View">⟲</button>
            `;

            toolbar.querySelector(".zoom-in").addEventListener("click", (e) => {
                e.preventDefault();
                panZoom.zoomIn();
            });

            toolbar
                .querySelector(".zoom-out")
                .addEventListener("click", (e) => {
                    e.preventDefault();
                    panZoom.zoomOut();
                });

            toolbar
                .querySelector(".zoom-reset")
                .addEventListener("click", (e) => {
                    e.preventDefault();
                    panZoom.reset();
                    panZoom.fit();
                    panZoom.center();
                });

            container.appendChild(toolbar);

            // Re-fit on container resize
            window.addEventListener("resize", () => {
                panZoom.resize();
                panZoom.fit();
                panZoom.center();
            });
        }
    });
}

// Hook into Material for MkDocs instant navigation
if (typeof document$ !== "undefined") {
    document$.subscribe(() => {
        // Run after DOM update
        setTimeout(initMermaidZoom, 300);
    });
}

// Fallback observer for async Mermaid rendering
document.addEventListener("DOMContentLoaded", () => {
    initMermaidZoom();

    const observer = new MutationObserver(() => {
        initMermaidZoom();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
});
