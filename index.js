'use strict';

const JSON5 = require('json5');
const { optimize } = require('svgo');
const { compile } = require('vue-template-compiler');

const stringify = (value) => value.filter((item) => item).join();
const specialValues = {
  null: null,
  true: true,
  false: false,
};

function parseQuery (query)
{
  if (query.substr(0, 1) !== '?')
  {
    throw new Error('A valid query string passed to parseQuery should begin with "?"');
  }

  query = query.substr(1);

  if (!query)
  {
    return {};
  }

  if (query.substr(0, 1) === '{' && query.substr(-1) === '}')
  {
    return JSON5.parse(query);
  }

  const queryArgs = query.split(/[,&]/g);
  const result = {};

  queryArgs.forEach((arg) =>
  {
    const idx = arg.indexOf('=');

    if (idx >= 0)
    {
      let name = arg.substr(0, idx);
      let value = decodeURIComponent(arg.substr(idx + 1));

      if (specialValues.hasOwnProperty(value))
      {
        value = specialValues[value];
      }

      if (name.substr(-2) === '[]')
      {
        name = decodeURIComponent(name.substr(0, name.length - 2));

        if (!Array.isArray(result[name]))
        {
          result[name] = [];
        }

        result[name].push(value);
      }
      else
      {
        name = decodeURIComponent(name);
        result[name] = value;
      }
    }
    else
    {
      if (arg.substr(0, 1) === '-')
      {
        result[decodeURIComponent(arg.substr(1))] = false;
      }
      else if (arg.substr(0, 1) === '+')
      {
        result[decodeURIComponent(arg.substr(1))] = true;
      }
      else
      {
        result[decodeURIComponent(arg)] = true;
      }
    }
  });

  return result;
}

function getOptions (loaderContext)
{
  const query = loaderContext.query;

  if (typeof query === 'string' && query !== '')
  {
    return parseQuery(loaderContext.query);
  }

  if (!query || typeof query !== 'object')
  {
    // Not object-like queries are not supported.
    return null;
  }

  return query;
}

const transformChildren = (value) =>
{
  const chilldren = value.reduce((acc, child) =>
  {
    if (child.text)
    {
      acc.push(`_v('${child.text}')`);
    }
    else
    {
      const args = [`'${child.tag}'`];

      if (Object.keys(child.attrsMap).length)
      {
        const data = [];

        if (child.staticClass)
        {
          data.push(`staticClass:${child.staticClass}`);
        }

        if (child.staticStyle)
        {
          data.push(`staticStyle:${child.staticStyle}`);
        }

        if (child.attrsList.length)
        {
          const attrs = child.attrsList.reduce((v, attr) => ({
            ...v,
            [attr.name]: attr.value,
          }), {});

          data.push(`attrs:${JSON.stringify(attrs)}`);
        }

        if (data.length)
        {
          args.push(`{${data.join()}}`);
        }
      }

      if (child.children.length)
      {
        args.push(transformChildren(child.children));
      }

      acc.push(`_c(${args.join()})`);
    }

    return acc;
  }, []);

  return `[${chilldren.join()}]`;
};

function svgToVue (content, options = {})
{
  const {
    svgoConfig = {},
    svgoPath = null,
  } = options;

  let result = content;

  if (svgoConfig !== false)
  {
    result = optimize(content, {
      ...svgoConfig,
      path: svgoPath
    }).data;
  }

  const { ast } = compile(result, {
    preserveWhitespace: false,
  });

  const children = ast.children.length
                   ? `children.concat(${transformChildren(ast.children)})`
                   : 'children';

  delete ast.attrsMap.class;

  const attrs = Object.keys(ast.attrsMap).length
                ? `attrs: Object.assign(${JSON.stringify(ast.attrsMap)}, attrs)`
                : 'attrs';

  const classNames = stringify([
    ast.staticClass,
    'classNames',
    'staticClass'
  ]);
  const styles = stringify([
    ast.staticStyle,
    'style',
    'staticStyle'
  ]);

  return `
    module.exports = {
      functional: true,
      render(_h, _vm) {
        const { _c, _v, data, children = [] } = _vm;

        const {
          class: classNames,
          staticClass,
          style,
          staticStyle,
          attrs = {},
          ...rest
        } = data;

        return _c(
          'svg',
          {
            class: [${classNames}],
            style: [${styles}],
            ${attrs},
            ...rest,
          },
          ${children}
        )
      }
    }
  `;
}

module.exports = function(content)
{
  const callback = this.async();
  const { svgo } = getOptions(this) || {};

  try
  {
    const result = svgToVue(content, {
      svgoPath: this.resourcePath,
      svgoConfig: svgo,
    });
    callback(null, result);
  }
  catch (e)
  {
    callback();
  }
};
