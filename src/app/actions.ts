"use server";

import {
  readIcpFormValues,
  validateIcpForm,
  type IcpFormState,
} from "./_lib/icp-form";

// Server Actions are reachable by direct POST, so the ICP is validated here
// even though the form also guides the user. The agent pipeline is not
// connected yet: an accepted ICP is only echoed back to the results area, and
// nothing here calls Crustdata.
export async function submitIcp(
  _prevState: IcpFormState,
  formData: FormData,
): Promise<IcpFormState> {
  const values = readIcpFormValues(formData);
  const result = validateIcpForm(values);

  if (!result.ok) {
    return {
      status: "invalid",
      values,
      errors: result.errors,
      message: "Check the highlighted fields and try again.",
    };
  }

  return { status: "accepted", values, icp: result.icp };
}
