(() => {
  const buttons = Array.from(document.querySelectorAll(".nav-item"));
  const sections = Array.from(document.querySelectorAll(".dashboard-section"));

  function showSection(sectionId) {
    sections.forEach((section) => {
      section.classList.toggle("active-section", section.id === sectionId);
    });

    buttons.forEach((button) => {
      const isActive = button.dataset.section === sectionId;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });
})();
