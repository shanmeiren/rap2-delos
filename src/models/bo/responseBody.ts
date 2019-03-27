import { Table, Column, Model, AutoIncrement, PrimaryKey, AllowNull, DataType, ForeignKey } from 'sequelize-typescript'
import { Interface } from '../'

@Table({ paranoid: true, freezeTableName: false, timestamps: true })
export default class ResponseBody extends Model<ResponseBody> {

    @AutoIncrement
    @PrimaryKey
    @Column
    id: number

    @Column({
        type: DataType.TEXT('medium'),
        comment: 'Auto capture response body',
    })
    body: string


    @ForeignKey(() => Interface)
    @Column
    interfaceId: number

}