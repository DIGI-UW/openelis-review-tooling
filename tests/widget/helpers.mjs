export async function panelAction(widget, name, options) {
  await widget.getByRole("button", { name: "More review actions" }).click();
  await widget.getByRole("button", { name }).click(options);
}
