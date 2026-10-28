const video = document.querySelector("video");
const chapters = [...document.querySelectorAll("[data-seconds]")];
for (const button of chapters)
  button.addEventListener("click", () => {
    video.currentTime = Number(button.dataset.seconds);
    video.play().catch(() => {});
    video.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  });
video.addEventListener("timeupdate", () => {
  const active = chapters.findLast(
    (button) => Number(button.dataset.seconds) <= video.currentTime,
  );
  for (const button of chapters)
    button.setAttribute("aria-pressed", String(button === active));
});
