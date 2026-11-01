"use strict";
(() => {
  const form=document.querySelector('.categories-form');if(!form)return;
  const list=form.querySelector('[data-category-list]');
  form.addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove-category]');
    if(remove){if(list.children.length>1)remove.closest('[data-category-row]').remove();return;}
    if(!event.target.closest('[data-add-category]')||list.children.length>=50)return;
    const row=document.createElement('div');row.className='categorie-ligne';row.dataset.categoryRow='';
    row.innerHTML='<input type="hidden" name="id"><input type="hidden" name="color" value="#788c5d"><span class="pastille" style="--c:#788c5d"></span><label>Nom de la catégorie<input name="name" maxlength="80" required></label><span class="categorie-compte">0 document</span><button type="button" data-remove-category>Retirer</button>';
    row.querySelector('[name=id]').value='category-'+crypto.randomUUID();list.append(row);row.querySelector('[name=name]').focus();
  });
})();
