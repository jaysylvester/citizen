// [pattern] controller

// default action
export const handler = async (params, context) => {
  let content = await [appName].models.[pattern].content()

  return {
    local: content
  }
}
