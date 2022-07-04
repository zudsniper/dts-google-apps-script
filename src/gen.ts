#!/usr/bin/env node --harmony

// tslint:disable: no-console

import fs from 'fs';

const GasNamespace = 'GoogleAppsScript';
const deprecationNotice = '/** @deprecated DO NOT USE */ ';

const header = fs.readFileSync('HEADER', { encoding: 'utf-8' }).replace(/{date}/, () => {
  const date = new Date();

  return `${date.getFullYear()}-${`0${date.getMonth() + 1}`.substr(-2)}-${`0${date.getDate()}`.substr(-2)}`;
});

let input = '';
process.stdin.on('data', (buf) => (input += buf.toString()));
process.stdin.on('end', () => {
  const data = JSON.parse(input);

  const indent = (text: string) => text.replace(/^./, '  $&');

  const makeDocComment = (docComment: string) => {
    const lines: string[] = [];
    lines.push('/**');
    docComment
      .replace(/( *\n){3,}/g, '\n\n')
      .replace(/\s+$/, '')
      .split(/\n/)
      .forEach((line) => lines.push(` * ${line}`));

    lines.push(' */');

    return lines;
  };

  const makeMethodDoc = (method: { docDetailed: string; url: string; isDeprecated: boolean; params: any }) => {
    const { docDetailed, url, isDeprecated, params } = method;
    if (isDeprecated) return [];
    const lines: string[] = [];
    lines.push(`\n      /**`);
    lines.push(...docDetailed.split('\n').map((detailLine) => `     * ${detailLine}`));
    lines.push(`     * ${url}`);
    params.map((param: any) => lines.push(`     * @param ${param.name} ${param.doc.replace(/\n\s*/g, ' ')}`));
    lines.push('     */\n    ');
    return lines;
  };

  Object.keys(data.categories)
    .sort()
    .forEach((categoryKey) => {
      let result: string[] = [];
      const exports: any = {};
      const category = data.categories[categoryKey];
      // const categoryName = category.name.replace(/\W/g, '_');
      const categoryName = category.name ? category.name.replace(/\W/g, '_') : 'UNKNOWN';
      const decls = category.decls;
      let references: string[];

      const makeTypedName = (o: any, isField?: boolean) => {
        let name = o.name;
        let typeName = o.type.name;
        const typeCategory = o.type.category;
        const dataCategory = data.categories[typeCategory];

        const typeIsEnum =
          isField === true &&
          dataCategory &&
          dataCategory.decls[typeName] &&
          dataCategory.decls[typeName].kind === 'enum';

        if (typeCategory && typeCategory !== categoryKey) {
          typeName = dataCategory.name ? `${dataCategory.name.replace(/\W/g, '_')}.${typeName}` : `UNKNOWN.${typeName}`;
          if (references.indexOf(typeCategory) === -1) {
            references.push(typeCategory);
          }
        }

        // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/dcb04cab793b8e2541274ca83d4fe39afe73e1b3
        typeName = typeName.replace('Object', 'any');

        // these are not defined in docs so types are not generated properly 
        typeName = typeName.replace(/(TimeInterval|TargetAudience)/g, 'any');

        if (/^(.+)\.\.\.$/.test(typeName)) {
          typeName = `${RegExp.$1}[]`;
          name = `...${o.name}`;
        }

        if (typeName.match(/^(Boolean|Number|String)\W*$/)) {
          typeName = typeName.toLowerCase();
        }

        return `${name}: ${typeIsEnum ? 'typeof ' : ''}${typeName}`;
      };

      references = ['types'];
      result.push(`declare namespace ${GasNamespace} {`, `  namespace ${categoryName} {`);

      Object.keys(decls)
        .sort()
        .forEach((declsKey) => {
          const decl = decls[declsKey];

          if (decl) {
            const lines = makeDocComment(decl.doc);
            const names = declsKey.split(/\./);
            const name = names.pop() as string;

            names.forEach((ns) => lines.push(`namespace ${ns} {`));

            if (decl.kind === 'enum') {
              lines.push(`enum ${name} { ${decl.properties.map((p: any) => p.name).join(', ')} }`);
            } else {
              // extend certain interfaces:
              // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/08bab0b659e21b94dbd04b70585508cd64e8284c
              // https://github.com/DefinitelyTyped/DefinitelyTyped/commit/f78a6e7b4748aff75150cf2bbe5140c88985ca5a#

              if (name === 'Blob') {
                lines.push(`interface Blob extends BlobSource {`);
              } else if (
                categoryName === 'Document' &&
                new Set([
                  'Body',
                  'ContainerElement',
                  'Equation',
                  'EquationFunction',
                  'EquationFunctionArgumentSeparator',
                  'EquationSymbol',
                  'FooterSection',
                  'Footnote',
                  'FootnoteSection',
                  'HeaderSection',
                  'HorizontalRule',
                  'InlineDrawing',
                  'InlineImage',
                  'ListItem',
                  'PageBreak',
                  'Paragraph',
                  'Table',
                  'TableCell',
                  'TableOfContents',
                  'TableRow',
                  'Text',
                  'UnsupportedElement',
                ]).has(name)
              ) {
                lines.push(`interface ${name} extends Element {`);
              } else {
                // all other interfaces
                lines.push(`interface ${name} {`);
              }

              lines.push(
                ...decl.properties
                  .map((p: any) => `${p.isDeprecated ? deprecationNotice : ''}${makeTypedName(p, true)};`)
                  .map(indent),
              );
              lines.push(
                ...decl.methods.map((method: any) =>
                  [
                    makeMethodDoc(method)
                      .map(indent)
                      .join('\n'),
                    indent(
                      `${method.isDeprecated ? deprecationNotice : ''}${makeTypedName({
                        name: `${method.name}(${
                          method.params
                            .map(makeTypedName)
                            .join(', ')
                            .replace(/(\bsql:.*)\bsql:/g, '$1sql_:') // ad-hoc fix for same-named arguments in jdbc
                        })`,
                        type: method.returnType,
                      })};`,
                    ),
                  ].join(''),
                ),
              );
              lines.push('}');
            }

            names.forEach(() => lines.push('}'));
            // lines.push('');

            if (data.services[decl.url]) {
              exports[name] = true;
            }

            result = result.concat(lines.map(indent).map(indent));
          }
        });

      result.push('  }', '}', '');

      Object.keys(exports)
        .sort()
        .forEach((declsKey) => {
          const line = `declare var ${declsKey}: ${GasNamespace}.${categoryName}.${declsKey};`;
          if (declsKey === 'MimeType') {
            result.push('// conflicts with MimeType in lib.d.ts');
            result.push(`// ${line}`);
          } else {
            result.push(line);
          }
        });

      result = [header]
        .concat(references.map((ref) => `/// <reference path="google-apps-script.${ref}.d.ts" />`))
        .concat('', result);

      const filename = `google-apps-script/google-apps-script.${categoryKey}.d.ts`;
      const fd = fs.openSync(filename, 'w');
      fs.writeSync(fd, `${result.join('\n').replace(/ +$/gm, '')}\n`);
      console.error(`Wrote to ${filename}`);
    });
});
